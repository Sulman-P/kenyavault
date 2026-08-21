// ============================================================
// KENYA VAULT - PAYMENT SERVER (COMPLETE)
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

// ─── GRANT RESOURCE ACCESS ────────────────────────────────────
async function grantResourceAccess(orderId, resourceIds) {
    try {
        console.log(`📚 Granting access to ${resourceIds.length} resources`);
        return true;
    } catch (error) {
        console.error('❌ Grant access error:', error);
        return false;
    }
}

// ─── STK PUSH ENDPOINT ──────────────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    
    try {
        const { phone, amount, order_id, customer_name, customer_email, resource_ids } = req.body;

        if (!phone || !amount || !order_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        const formattedPhone = validatePhoneNumber(phone);
        if (!formattedPhone) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number'
            });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount'
            });
        }

        const reference = generateTransactionReference();

        console.log('📤 Sending STK Push:', { phone: formattedPhone, amount: numericAmount, reference });

        // ─── SAVE REFERENCE TO ORDER ──────────────────────────
        const { error: updateError } = await supabase
            .from('orders')
            .update({
                payment_reference: reference,
                payment_status: 'pending',
                updated_at: new Date().toISOString()
            })
            .eq('id', order_id);

        if (updateError) {
            console.error('❌ Error updating order:', updateError);
        }

        // ─── MEGAPAY PAYLOAD ────────────────────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: numericAmount,
            msisdn: formattedPhone,
            reference: reference
        };

        const megaPayResponse = await fetch(MEGAPAY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(megaPayPayload)
        });

        const responseText = await megaPayResponse.text();
        let megaPayResult;
        try {
            megaPayResult = JSON.parse(responseText);
        } catch (e) {
            return res.status(500).json({
                success: false,
                error: 'Invalid response from MegaPay',
                raw: responseText
            });
        }

        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.status === 'success' || 
                         megaPayResult.success === true;

        if (isSuccess) {
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    reference: reference,
                    order_id: order_id,
                    status: 'pending',
                    phone: formattedPhone
                }
            });
        } else {
            return res.status(400).json({
                success: false,
                error: megaPayResult.errorMessage || 'Failed to send STK Push'
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

// ─── CALLBACK ENDPOINT - FIXED ──────────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 Callback received!');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const data = req.body;
        
        // Extract reference
        let reference = data.reference || data.Reference || data.order_ref || data.payment_reference;
        
        if (!reference) {
            return res.status(200).json({ 
                success: true, 
                message: 'No reference found',
                body: req.body
            });
        }
        
        console.log(`🔍 Looking for reference: ${reference}`);
        
        // Find the order
        const { data: order, error: findError } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .single();
        
        if (findError || !order) {
            console.error(`❌ Order not found for reference: ${reference}`);
            // Try finding by order_ref or id
            const { data: orderByRef, error: refError } = await supabase
                .from('orders')
                .select('*')
                .eq('order_ref', reference)
                .single();
            
            if (refError || !orderByRef) {
                return res.status(200).json({ 
                    success: true, 
                    message: 'Order not found',
                    reference: reference 
                });
            }
            // Use the found order
            order = orderByRef;
        }
        
        // Check if paid
        const isPaid = data.ResultCode === '0' || data.ResultCode === 0 ||
                      data.status === 'success' || data.status === 'completed' ||
                      data.ResultCode === 'SUCCESS';
        
        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        console.log(`📊 Order ID: ${order.id}, Current status: ${order.status}`);
        
        // ─── FIX: UPDATE ALL PAYMENT FIELDS ──────────────────────────
        const updateData = {
            status: isPaid ? 'paid' : 'failed',
            payment_status: isPaid ? 'paid' : 'failed',
            payment_confirmed: isPaid,  // ← CRITICAL FIX: Set this to true
            payment_verified: isPaid,
            payment_verified_at: isPaid ? new Date().toISOString() : null,
            mpesa_transaction_id: data.TransactionID || data.transaction_id || null,
            mpesa_code: data.TransactionID || data.transaction_id || null,
            transaction_code: data.TransactionID || data.transaction_id || null,
            confirmed_at: isPaid ? new Date().toISOString() : null,
            paid_at: isPaid ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
        };
        
        // If payment failed, add failure reason
        if (!isPaid) {
            updateData.failure_reason = data.ResultDesc || data.errorMessage || 'Payment failed';
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
        
        console.log(`✅ Order ${order.id} updated to ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        
        // ─── VERIFY THE UPDATE ──────────────────────────────────────
        const { data: verifyOrder, error: verifyError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', order.id)
            .single();
        
        if (!verifyError && verifyOrder) {
            console.log('🔍 Verified order status:', {
                id: verifyOrder.id,
                status: verifyOrder.status,
                payment_status: verifyOrder.payment_status,
                payment_confirmed: verifyOrder.payment_confirmed,
                payment_verified: verifyOrder.payment_verified
            });
        }
        
        res.status(200).json({
            success: true,
            message: 'Callback processed',
            order_id: order.id,
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
                      order.payment_verified === true;
        
        return res.status(200).json({
            success: true,
            data: {
                status: order.status,
                payment_verified: order.payment_verified || false,
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
            status: 'GET /api/mpesa/status/:orderId'
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
