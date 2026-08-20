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
const allowedOrigins = [
    'https://kenyavault.co.ke',
    'https://www.kenyavault.co.ke',
    'http://localhost:5500',
    'http://localhost:3000',
    'https://kenyavault.onrender.com'
];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
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
        console.log(`📚 Granting access to ${resourceIds.length} resources for order ${orderId}`);
        
        if (!resourceIds || resourceIds.length === 0) {
            console.log('⚠️ No resource IDs to grant access to');
            return false;
        }
        
        for (let i = 0; i < resourceIds.length; i++) {
            const resourceId = resourceIds[i];
            
            // Get current download count
            const { data: resource, error: resourceError } = await supabase
                .from('resources')
                .select('download_count')
                .eq('id', resourceId)
                .single();

            if (resourceError) {
                console.error(`❌ Error finding resource ${resourceId}:`, resourceError);
                continue;
            }

            const currentCount = resource?.download_count || 0;

            // Increment download count
            const { error: updateError } = await supabase
                .from('resources')
                .update({
                    download_count: currentCount + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('id', resourceId);

            if (updateError) {
                console.error(`❌ Error updating download count for ${resourceId}:`, updateError);
            } else {
                console.log(`✅ Updated download count for resource ${resourceId} to ${currentCount + 1}`);
            }
        }
        return true;
    } catch (error) {
        console.error('❌ Grant access error:', error);
        return false;
    }
}

// ─── LOGGING ──────────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        console.log('Body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

// ─── STK PUSH ENDPOINT ──────────────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    
    try {
        const { phone, amount, order_id, customer_name, customer_email, resource_ids } = req.body;

        // Validate
        if (!phone || !amount || !order_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: phone, amount, order_id'
            });
        }

        const formattedPhone = validatePhoneNumber(phone);
        if (!formattedPhone) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number. Use 07XXXXXXXX or 2547XXXXXXXX'
            });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount. Must be a positive number.'
            });
        }

        const reference = generateTransactionReference();

        console.log('📤 Sending STK Push:');
        console.log('Phone:', formattedPhone);
        console.log('Amount:', numericAmount);
        console.log('Reference:', reference);
        console.log('Order ID:', order_id);

        // ─── MEGAPAY PAYLOAD ────────────────────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: numericAmount,
            msisdn: formattedPhone,
            reference: reference
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload, null, 2));

        // ─── CALL MEGAPAY API ──────────────────────────────
        const megaPayResponse = await fetch(MEGAPAY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(megaPayPayload)
        });

        const responseText = await megaPayResponse.text();
        console.log('📥 MegaPay Raw Response:', responseText);

        let megaPayResult;
        try {
            megaPayResult = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Failed to parse MegaPay response');
            return res.status(500).json({
                success: false,
                error: 'Invalid response from payment gateway',
                raw: responseText
            });
        }

        console.log('📥 MegaPay Result:', JSON.stringify(megaPayResult, null, 2));

        // Check if successful
        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.status === 'success' || 
                         megaPayResult.success === true;

        if (isSuccess) {
            console.log('✅ STK Push sent successfully!');
            
            // Update the order with the payment reference
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    payment_reference: reference,
                    payment_status: 'pending',
                    updated_at: new Date().toISOString()
                })
                .eq('id', order_id);

            if (updateError) {
                console.error('❌ Error updating order with reference:', updateError);
            } else {
                console.log('✅ Order updated with payment reference:', reference);
            }

            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    reference: reference,
                    order_id: order_id,
                    check_interval: 3,
                    status: 'pending',
                    phone: formattedPhone,
                    mega_pay_response: megaPayResult
                }
            });
        } else {
            console.log('❌ STK Push failed:', megaPayResult);
            return res.status(400).json({
                success: false,
                error: megaPayResult.errorMessage || megaPayResult.message || 'Failed to send STK Push',
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

// ─── ENHANCED CALLBACK HANDLER ──────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 M-Pesa Callback Received!');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const data = req.body;
        
        // ─── EXTRACT REFERENCE ──────────────────────────────────
        let reference = data.reference || 
                       data.Reference || 
                       data.order_ref || 
                       data.payment_reference ||
                       data.MerchantRequestID ||
                       data.CheckoutRequestID;
        
        // If reference has KV- prefix but we got something else, try to find it
        if (!reference || !reference.startsWith('KV-')) {
            const jsonString = JSON.stringify(data);
            const match = jsonString.match(/KV-[A-Z0-9-]+/);
            if (match) {
                reference = match[0];
            }
        }
        
        console.log(`🔍 Extracted reference: ${reference}`);
        
        if (!reference) {
            console.error('❌ No reference found in callback');
            return res.status(200).json({ 
                success: true, 
                message: 'No reference found'
            });
        }
        
        // ─── FIND THE ORDER ──────────────────────────────────────
        let order = null;
        
        // Try by payment_reference
        const { data: orderByRef, error: refError } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .single();
        
        if (!refError && orderByRef) {
            order = orderByRef;
            console.log(`✅ Found order by payment_reference: ${order.id}`);
            console.log(`📊 Current order status: ${order.status}, payment_verified: ${order.payment_verified}`);
        }
        
        // Try by order_ref
        if (!order) {
            const { data: orderByOrderRef, error: orderRefError } = await supabase
                .from('orders')
                .select('*')
                .eq('order_ref', reference)
                .single();
            
            if (!orderRefError && orderByOrderRef) {
                order = orderByOrderRef;
                console.log(`✅ Found order by order_ref: ${order.id}`);
                console.log(`📊 Current order status: ${order.status}, payment_verified: ${order.payment_verified}`);
            }
        }
        
        if (!order) {
            console.error(`❌ Order not found for reference: ${reference}`);
            return res.status(200).json({ 
                success: true, 
                message: 'Order not found',
                reference: reference
            });
        }
        
        // ─── CHECK IF PAID ──────────────────────────────────────
        const isPaid = data.ResultCode === '0' || 
                      data.ResultCode === 0 ||
                      data.status === 'success' ||
                      data.status === 'completed' ||
                      data.success === true;
        
        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        console.log(`📊 ResultCode: ${data.ResultCode}`);
        console.log(`📊 Status: ${data.status}`);
        
        // ─── UPDATE THE ORDER ──────────────────────────────────
        const updateData = {
            status: isPaid ? 'paid' : 'failed',
            payment_status: isPaid ? 'paid' : 'failed',
            payment_verified: isPaid,
            payment_verified_at: isPaid ? new Date().toISOString() : null,
            mpesa_transaction_id: data.TransactionID || data.transaction_id || null,
            mpesa_code: data.TransactionID || data.transaction_id || null,
            updated_at: new Date().toISOString()
        };
        
        console.log(`📝 Updating order with:`, JSON.stringify(updateData, null, 2));
        
        const { data: updatedOrder, error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order.id)
            .select();
        
        if (updateError) {
            console.error('❌ Error updating order:', updateError);
            return res.status(200).json({
                success: false,
                error: 'Failed to update order',
                details: updateError
            });
        }
        
        console.log(`✅ Order ${order.id} updated successfully!`);
        console.log(`📊 New status: ${isPaid ? 'PAID' : 'FAILED'}`);
        console.log(`📊 Updated order:`, JSON.stringify(updatedOrder, null, 2));
        
        // ─── GRANT ACCESS IF PAID ──────────────────────────────
        if (isPaid && order.resource_ids && order.resource_ids.length > 0) {
            console.log(`📚 Granting access to resources: ${order.resource_ids}`);
            await grantResourceAccess(order.id, order.resource_ids);
        }
        
        res.status(200).json({
            success: true,
            message: 'Callback processed',
            order_id: order.id,
            status: isPaid ? 'paid' : 'failed',
            updated_order: updatedOrder
        });
        
    } catch (error) {
        console.error('❌ Callback error:', error);
        res.status(200).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

// ─── CHECK ORDER STATUS ──────────────────────────────────────
app.get('/api/mpesa/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        console.log(`📊 Status check for order: ${orderId}`);
        
        // Try by id first
        let { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();
        
        // If not found, try by order_ref
        if (error || !order) {
            const { data: orderByRef, error: refError } = await supabase
                .from('orders')
                .select('*')
                .eq('order_ref', orderId)
                .single();
            
            if (!refError && orderByRef) {
                order = orderByRef;
            }
        }
        
        if (!order) {
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
                payment_reference: order.payment_reference,
                amount: order.amount,
                order_ref: order.order_ref
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
    console.log('✅ Health check called');
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
