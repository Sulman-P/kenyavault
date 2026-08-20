// ============================================================
// KENYA VAULT - PAYMENT SERVER (EMAIL FIXED)
// ============================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

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
const MEGAPAY_EMAIL = 'adminnexalearn@gmail.com'; // ← YOUR REGISTERED MEGAPAY EMAIL
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
        const { phone, amount, order_id, customer_name } = req.body;

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

        // ─── MEGAPAY PAYLOAD (FIXED EMAIL) ─────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,  // ← USING REGISTERED EMAIL
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

        // Check if successful - MegaPay uses ResultCode: '0' for success
        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.status === 'success' || 
                         megaPayResult.success === true;

        if (isSuccess) {
            console.log('✅ STK Push sent successfully!');
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

// ─── SIMPLIFIED CALLBACK HANDLER ──────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 M-Pesa Callback Received!');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const data = req.body;
        
        // Extract reference from MegaPay response
        // MegaPay sends reference in the response
        const reference = data.reference || data.Reference || data.order_ref;
        
        console.log(`🔍 Looking for reference: ${reference}`);
        
        if (!reference) {
            console.error('❌ No reference found in callback');
            return res.status(200).json({ 
                success: true, 
                message: 'No reference found' 
            });
        }
        
        // ─── FIND THE ORDER BY REFERENCE ──────────────────────
        const { data: order, error: findError } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .single();
        
        if (findError || !order) {
            console.error(`❌ Order not found for reference: ${reference}`);
            // Try to find by order_ref as fallback
            const { data: orderByRef, error: refError } = await supabase
                .from('orders')
                .select('*')
                .eq('order_ref', reference)
                .single();
            
            if (refError || !orderByRef) {
                console.error('❌ Order not found by any reference');
                return res.status(200).json({ 
                    success: true, 
                    message: 'Order not found' 
                });
            }
            var foundOrder = orderByRef;
        } else {
            var foundOrder = order;
        }
        
        console.log(`✅ Found order: ${foundOrder.id}`);
        
        // ─── CHECK IF PAID ──────────────────────────────────────
        // MegaPay uses ResultCode: '0' for success
        const isPaid = data.ResultCode === '0' || 
                      data.ResultCode === 0 ||
                      data.status === 'success' ||
                      data.status === 'completed';
        
        console.log(`💰 Payment status: ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        
        // ─── UPDATE THE ORDER ──────────────────────────────────
        const updateData = {
            status: isPaid ? 'paid' : 'failed',
            payment_status: isPaid ? 'paid' : 'failed',
            payment_verified: isPaid,
            payment_verified_at: isPaid ? new Date().toISOString() : null,
            updated_at: new Date().toISOString()
        };
        
        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', foundOrder.id);
        
        if (updateError) {
            console.error('❌ Error updating order:', updateError);
            return res.status(500).json({
                success: false,
                error: 'Failed to update order'
            });
        }
        
        console.log(`✅ Order ${foundOrder.id} updated to ${isPaid ? 'PAID' : 'FAILED'}`);
        
        // ─── GRANT ACCESS ──────────────────────────────────────
        if (isPaid && foundOrder.resource_ids) {
            await grantResourceAccess(foundOrder.id, foundOrder.resource_ids);
        }
        
        res.status(200).json({
            success: true,
            message: 'Callback processed',
            order_id: foundOrder.id,
            status: isPaid ? 'paid' : 'failed'
        });
        
    } catch (error) {
        console.error('❌ Callback error:', error);
        res.status(200).json({
            success: false,
            error: error.message
        });
    }
});

// ─── ROOT ────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'KenyaVault Payment Server is running!',
        endpoints: {
            stk_push: 'POST /api/mpesa/stk-push',
            health: 'GET /api/health',
            callback: 'POST /api/mpesa/callback'
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
