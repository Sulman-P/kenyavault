// ============================================================
// KENYA VAULT - PAYMENT BACKEND SERVER (MEGAPAY FIXED)
// Using correct MegaPay API format from PHP example
// ============================================================

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// MegaPay Configuration - UPDATED from PHP example
const MEGAPAY_API_KEY = 'MGPYDSg2lIYA';
const MEGAPAY_API_URL = 'https://megapay.co.ke/backend/v1/initiatestk'; // Note: /v1/ in URL
const MEGAPAY_CALLBACK_URL = 'https://kenyavault.onrender.com/api/mpesa/callback';

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── LOGGING ──────────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        console.log('Body:', JSON.stringify(req.body, null, 2));
    }
    next();
});

// ─── HELPERS ──────────────────────────────────────────────────
function generateTransactionReference() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `KV-${timestamp}-${random}`;
}

function validatePhoneNumber(phone) {
    // Accept both 07XXXXXXXX and 2547XXXXXXXX formats
    let cleaned = phone.replace(/\D/g, '');
    
    // If it starts with 0, keep as is (MegaPay accepts 07XXXXXXXX)
    if (cleaned.startsWith('0') && cleaned.length === 10) {
        return cleaned;
    }
    
    // If it starts with 254, convert to 07XXXXXXXX
    if (cleaned.startsWith('254') && cleaned.length === 12) {
        return '0' + cleaned.substring(3);
    }
    
    // If it has +254, convert to 07XXXXXXXX
    if (phone && phone.startsWith('+254')) {
        return '0' + phone.substring(4).replace(/\D/g, '');
    }
    
    return null;
}

// ─── STK PUSH ENDPOINT ──────────────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    
    try {
        const { phone, amount, order_id, customer_name, customer_email } = req.body;

        // Validate
        if (!phone || !amount || !order_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: phone, amount, order_id'
            });
        }

        // Format phone number for MegaPay (expects 07XXXXXXXX)
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
        console.log('Phone (msisdn):', formattedPhone);
        console.log('Amount:', numericAmount);
        console.log('Reference:', reference);
        console.log('Order ID:', order_id);

        // ─── MEGAPAY PAYLOAD (MATCHES PHP EXAMPLE) ────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: customer_email || 'adminnexalearn@gmail.com', // Required by MegaPay
            amount: numericAmount,
            msisdn: formattedPhone, // Note: parameter name is 'msisdn'
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

        // Try to parse JSON
        let megaPayResult;
        try {
            megaPayResult = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Failed to parse MegaPay response as JSON');
            return res.status(500).json({
                success: false,
                error: 'Invalid response from payment gateway',
                raw_response: responseText.substring(0, 200)
            });
        }

        console.log('📥 MegaPay Parsed Result:', JSON.stringify(megaPayResult, null, 2));

        // ─── HANDLE RESPONSE ────────────────────────────────
        // Check if STK Push was successful
        const isSuccess = megaPayResult.status === 'success' || 
                         megaPayResult.success === true ||
                         (megaPayResult.message && megaPayResult.message.toLowerCase().includes('sent'));

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
                error: megaPayResult.message || megaPayResult.error || 'Failed to send STK Push',
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
            health: 'GET /api/health'
        }
    });
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/api/health`);
    console.log(`📞 MegaPay API URL: ${MEGAPAY_API_URL}`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`✅ Server is ready!`);
});

module.exports = app;
