// ============================================================
// KENYA VAULT - PAYMENT SERVER (COMPLETE FIXED)
// ============================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc0OTM5OSwiZXhwIjoyMDk3MzI1Mzk5fQ.X2Rz5vLgv0Z-sPR7WqWj_yXItwxrX_JLtJAb4S2r8jE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── CORS ──────────────────────────────────────────────────────
app.use(cors({
    origin: [
        'https://kenyavault.co.ke',
        'https://www.kenyavault.co.ke',
        'http://localhost:5500',
        'http://localhost:3000',
        'https://kenyavault.onrender.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── MEGAPAY CONFIG ──────────────────────────────────────────
const MEGAPAY_API_KEY = 'MGPYDSg2lIYA';
const MEGAPAY_EMAIL = 'adminnexalearn@gmail.com';
const MEGAPAY_API_URL = 'https://megapay.co.ke/backend/v1/initiatestk';
const MEGAPAY_CALLBACK_URL = 'https://kenyavault.onrender.com/api/mpesa/callback';

// ─── HELPERS ──────────────────────────────────────────────────
function generateTransactionReference() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `KV-${timestamp}-${random}`;
}

function validatePhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.startsWith('0') && cleaned.length === 10) {
        return cleaned;
    }
    
    if (cleaned.startsWith('254') && cleaned.length === 12) {
        return '0' + cleaned.substring(3);
    }
    
    if (phone && phone.startsWith('+254')) {
        return '0' + phone.substring(4).replace(/\D/g, '');
    }
    
    return null;
}

// ─── STK PUSH ENDPOINT - COMPLETE FIX ────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    console.log('📥 Request body:', req.body);
    
    try {
        const { phone, amount, order_id, order_ref, customer_name, customer_email, resource_ids } = req.body;

        // Validate required fields
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            });
        }

        if (!amount) {
            return res.status(400).json({
                success: false,
                error: 'Amount is required'
            });
        }

        if (!order_id) {
            return res.status(400).json({
                success: false,
                error: 'Order ID is required'
            });
        }

        const formattedPhone = validatePhoneNumber(phone);
        if (!formattedPhone) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number format. Please use 07XXXXXXXX'
            });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount. Amount must be greater than 0'
            });
        }

        // Check if amount is too small (M-PESA minimum is usually 1 KES)
        if (numericAmount < 1) {
            return res.status(400).json({
                success: false,
                error: 'Minimum amount is KES 1'
            });
        }

        const reference = generateTransactionReference();
        const orderRef = order_ref || 'ORD-' + Date.now().toString().slice(-8);

        console.log('📤 Sending STK Push:', { 
            phone: formattedPhone, 
            amount: numericAmount, 
            reference,
            order_id,
            orderRef
        });

        // ─── SAVE REFERENCE TO ORDER ──────────────────────────
        try {
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    payment_reference: reference,
                    transaction_reference: reference,
                    payment_status: 'pending',
                    updated_at: new Date().toISOString()
                })
                .eq('id', order_id);

            if (updateError) {
                console.warn('⚠️ Error updating order (non-critical):', updateError);
            }
        } catch (updateError) {
            console.warn('⚠️ Update error (non-critical):', updateError);
        }

        // ─── MEGAPAY PAYLOAD ────────────────────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: numericAmount,
            msisdn: formattedPhone,
            reference: reference,
            callback_url: MEGAPAY_CALLBACK_URL,
            order_ref: orderRef,
            order_id: order_id,
            customer_name: customer_name || 'Customer',
            customer_email: customer_email || 'customer@kenyavault.co.ke'
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload, null, 2));

        // ─── CALL MEGAPAY API ──────────────────────────────────
        let megaPayResponse;
        try {
            megaPayResponse = await fetch(MEGAPAY_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(megaPayPayload)
            });
        } catch (fetchError) {
            console.error('❌ Fetch error:', fetchError);
            return res.status(500).json({
                success: false,
                error: 'Failed to connect to MegaPay: ' + fetchError.message
            });
        }

        const responseText = await megaPayResponse.text();
        console.log('📥 MegaPay Raw Response:', responseText);
        
        // ─── PARSE MEGAPAY RESPONSE ────────────────────────────
        let megaPayResult;
        try {
            megaPayResult = JSON.parse(responseText);
        } catch (parseError) {
            console.error('❌ Failed to parse MegaPay response:', parseError);
            console.error('Raw response:', responseText);
            
            // Check if response contains HTML or error page
            if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
                return res.status(500).json({
                    success: false,
                    error: 'MegaPay returned an error page. Please check your configuration.'
                });
            }
            
            return res.status(500).json({
                success: false,
                error: 'Invalid response from MegaPay: ' + responseText.substring(0, 200)
            });
        }

        // ─── CHECK MEGAPAY RESPONSE ────────────────────────────
        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.ResultCode === '00' ||
                         megaPayResult.status === 'success' || 
                         megaPayResult.success === true ||
                         megaPayResult.ResultCode === 'SUCCESS';

        if (isSuccess) {
            console.log('✅ STK Push sent successfully!');
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    reference: reference,
                    order_id: order_id,
                    order_ref: orderRef,
                    status: 'pending',
                    phone: formattedPhone,
                    megaPayResult: megaPayResult
                }
            });
        } else {
            // MegaPay returned an error
            const errorMessage = megaPayResult.ResultDesc || 
                                megaPayResult.errorMessage || 
                                megaPayResult.message ||
                                'Unknown MegaPay error';
            
            console.error('❌ MegaPay error:', errorMessage);
            console.error('Full response:', megaPayResult);
            
            // Update order with error
            try {
                await supabase
                    .from('orders')
                    .update({
                        payment_error: errorMessage,
                        payment_status: 'failed',
                        status: 'failed',
                        failure_reason: errorMessage,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order_id);
            } catch (updateError) {
                console.warn('⚠️ Failed to update order with error:', updateError);
            }
            
            return res.status(400).json({
                success: false,
                error: errorMessage,
                details: megaPayResult
            });
        }

    } catch (error) {
        console.error('❌ STK Push Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── CALLBACK ENDPOINT ──────────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 Callback received!');
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const data = req.body;
        
        let reference = data.reference || data.Reference || data.order_ref || data.payment_reference || data.checkout_request_id;
        
        if (!reference) {
            console.warn('⚠️ No reference found in callback, returning OK');
            return res.status(200).json({ 
                success: true, 
                message: 'No reference found',
                body: req.body
            });
        }
        
        console.log(`🔍 Looking for reference: ${reference}`);
        
        let order = null;
        
        // Try by payment_reference
        const { data: orderByRef, error: refError } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .maybeSingle();
        
        if (orderByRef) {
            order = orderByRef;
            console.log(`✅ Found order by payment_reference: ${order.order_ref}`);
        } else {
            // Try by order_ref
            const { data: orderByOrderRef, error: orderRefError } = await supabase
                .from('orders')
                .select('*')
                .eq('order_ref', reference)
                .maybeSingle();
            
            if (orderByOrderRef) {
                order = orderByOrderRef;
                console.log(`✅ Found order by order_ref: ${order.order_ref}`);
            }
        }
        
        if (!order) {
            console.error(`❌ Order not found for reference: ${reference}`);
            return res.status(200).json({ 
                success: true, 
                message: 'Order not found but callback acknowledged',
                reference: reference 
            });
        }
        
        // Check if paid
        const isPaid = data.ResultCode === '0' || data.ResultCode === 0 ||
                      data.ResultCode === '00' ||
                      data.status === 'success' || data.status === 'completed' ||
                      data.ResultCode === 'SUCCESS' ||
                      data.ResultDesc === 'Success' ||
                      data.ResultDesc === 'The service request is processed successfully.';
        
        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        console.log(`📊 Order ID: ${order.id}, Current status: ${order.status}`);
        
        // ─── UPDATE ALL PAYMENT FIELDS ──────────────────────────
        const updateData = {
            status: isPaid ? 'paid' : 'failed',
            payment_status: isPaid ? 'paid' : 'failed',
            payment_confirmed: isPaid,
            payment_verified: isPaid,
            payment_verified_at: isPaid ? new Date().toISOString() : null,
            mpesa_transaction_id: data.TransactionID || data.transaction_id || null,
            mpesa_code: data.TransactionID || data.transaction_id || null,
            transaction_code: data.TransactionID || data.transaction_id || null,
            mpesa_receipt: data.TransactionID || data.transaction_id || null,
            confirmed_at: isPaid ? new Date().toISOString() : null,
            paid_at: isPaid ? new Date().toISOString() : null,
            amount_paid: isPaid ? (data.Amount || data.amount || order.total_amount || 0) : 0,
            updated_at: new Date().toISOString()
        };
        
        if (!isPaid) {
            updateData.failure_reason = data.ResultDesc || data.errorMessage || 'Payment failed';
            updateData.payment_error = data.ResultDesc || data.errorMessage || 'Payment failed';
        }
        
        console.log('📝 Updating order with:', updateData);
        
        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order.id);
        
        if (updateError) {
            console.error('❌ Update error:', updateError);
            return res.status(200).json({
                success: false,
                error: 'Failed to update order: ' + updateError.message
            });
        }
        
        console.log(`✅ Order ${order.order_ref} updated to ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        
        res.status(200).json({
            success: true,
            message: 'Callback processed',
            order_id: order.id,
            order_ref: order.order_ref,
            status: isPaid ? 'paid' : 'failed',
            payment_confirmed: isPaid
        });
        
    } catch (error) {
        console.error('❌ Callback error:', error);
        res.status(200).json({
            success: false,
            error: error.message
        });
    }
});

// ─── CHECK ORDER STATUS ──────────────────────────────────────
app.get('/api/mpesa/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        console.log(`📊 Status check for order: ${orderId}`);
        
        const { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();
        
        if (error || !order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        const isPaid = order.status === 'paid' || 
                      order.payment_status === 'paid' || 
                      order.payment_verified === true ||
                      order.payment_confirmed === true;
        
        return res.status(200).json({
            success: true,
            data: {
                status: order.status,
                payment_verified: order.payment_verified || false,
                payment_confirmed: order.payment_confirmed || false,
                payment_reference: order.payment_reference
            }
        });
        
    } catch (error) {
        console.error('❌ Status check error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── TEST CALLBACK ENDPOINT ──────────────────────────────────────
app.post('/api/mpesa/test-callback', async (req, res) => {
    console.log('🧪 Test callback received!');
    console.log('📥 Body:', req.body);
    
    const { order_ref, payment_reference, status, amount, transaction_id } = req.body;
    
    if (!order_ref && !payment_reference) {
        return res.status(400).json({
            success: false,
            error: 'Missing order_ref or payment_reference'
        });
    }
    
    try {
        let query = supabase.from('orders').select('*');
        if (order_ref) {
            query = query.eq('order_ref', order_ref);
        } else if (payment_reference) {
            query = query.eq('payment_reference', payment_reference);
        }
        
        const { data: order, error } = await query.single();
        
        if (error || !order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        const isPaid = status === 'paid' || status === 'success' || status === 'completed';
        
        const { error: updateError } = await supabase
            .from('orders')
            .update({
                status: isPaid ? 'paid' : 'failed',
                payment_status: isPaid ? 'paid' : 'failed',
                payment_confirmed: isPaid,
                payment_verified: isPaid,
                confirmed_at: isPaid ? new Date().toISOString() : null,
                paid_at: isPaid ? new Date().toISOString() : null,
                amount_paid: amount || order.total_amount || 0,
                mpesa_code: transaction_id || null,
                transaction_code: transaction_id || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', order.id);
        
        if (updateError) {
            return res.status(500).json({
                success: false,
                error: updateError.message
            });
        }
        
        console.log(`✅ Test callback: Order ${order.order_ref} updated to ${isPaid ? 'PAID' : 'FAILED'}`);
        
        res.status(200).json({
            success: true,
            message: `Order ${order.order_ref} updated to ${isPaid ? 'PAID' : 'FAILED'}`,
            order: order,
            status: isPaid ? 'paid' : 'failed'
        });
        
    } catch (error) {
        console.error('❌ Test callback error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            megapay: 'configured',
            callback_url: MEGAPAY_CALLBACK_URL
        }
    });
});

// ─── ROOT ────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'KenyaVault Payment Server is running!',
        endpoints: {
            stk_push: 'POST /api/mpesa/stk-push',
            health: 'GET /api/health',
            callback: 'POST /api/mpesa/callback',
            status: 'GET /api/mpesa/status/:orderId',
            test_callback: 'POST /api/mpesa/test-callback'
        }
    });
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: https://kenyavault.onrender.com/api/health`);
    console.log(`📞 MegaPay API: ${MEGAPAY_API_URL}`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`✅ Server is ready!`);
});

module.exports = app;
