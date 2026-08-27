// ============================================================
// KENYA VAULT - PAYMENT SERVER (NO SENTRY)
// ============================================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc0OTM5OSwiZXhwIjoyMDk3MzI1Mzk5fQ.qkL7O1o1dhf9jCFuIQIUyJWFUBaq404ePWU0X4I5p1k';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log('✅ Supabase initialized');

// ─── CORS ──────────────────────────────────────────────────────
app.use(cors({
    origin: [
        'https://kenyavault.co.ke',
        'https://www.kenyavault.co.ke',
        'http://localhost:5500',
        'http://localhost:3000',
        'http://localhost:8080',
        'https://kenyavault.pages.dev',
        '*.pages.dev',
        'https://kenyavault-api.onrender.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    credentials: true
}));

app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(200);
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── MEGAPAY CONFIG ──────────────────────────────────────────
const MEGAPAY_API_KEY = 'MGPYDSg2lIYA';
const MEGAPAY_EMAIL = 'adminnexalearn@gmail.com';
const MEGAPAY_INITIATE_URL = 'https://megapay.co.ke/backend/v1/initiatestk';
const MEGAPAY_STATUS_URL = 'https://megapay.co.ke/backend/v1/transactionstatus';

// ─── HELPERS ──────────────────────────────────────────────────
function generateTransactionReference() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `KV-${timestamp}-${random}`;
}

function generateOrderRef() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ORD-${year}${month}${day}-${hours}${minutes}${seconds}${ms}-${random}`;
}

function validatePhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0') && cleaned.length === 10) return cleaned;
    if (cleaned.startsWith('254') && cleaned.length === 12) return '0' + cleaned.substring(3);
    if (cleaned.startsWith('+254')) return '0' + cleaned.substring(4).replace(/\D/g, '');
    if (cleaned.length === 9 && cleaned.startsWith('7')) return '0' + cleaned;
    return null;
}

function logPaymentEvent(event, data) {
    console.log(`[PAYMENT] ${event}:`, JSON.stringify(data, null, 2));
}

// ─── FULFILL PURCHASE ──────────────────────────────────────────────
async function fulfillPurchase(orderId) {
    console.log(`📦 Fulfilling order: ${orderId}`);
    try {
        const { data: order } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();
        
        if (!order || (order.payment_status !== 'paid' && order.payment_confirmed !== true)) {
            console.log(`⏳ Order ${orderId} not paid yet.`);
            return;
        }
        
        let items = order.cart_items;
        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch (e) { items = []; }
        }
        
        if (!items || items.length === 0) return;
        
        for (const item of items) {
            const resourceId = item.id || item.resource_id;
            if (!resourceId) continue;
            
            const { data: resource } = await supabase
                .from('resources')
                .select('download_count')
                .eq('id', resourceId)
                .single();
            
            if (resource) {
                const newCount = (resource.download_count || 0) + 1;
                await supabase
                    .from('resources')
                    .update({ download_count: newCount })
                    .eq('id', resourceId);
                console.log(`✅ Download count updated: ${resourceId} -> ${newCount}`);
            }
        }
        
        await supabase
            .from('orders')
            .update({
                file_delivered: true,
                file_delivered_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', orderId);
            
        console.log(`✅ Purchase fulfilled for order ${orderId}`);
    } catch (error) {
        console.error('❌ Fulfillment error:', error);
    }
}

// ─── CHECK MEGAPAY STATUS ──────────────────────────────────────────
async function checkMegaPayStatus(transactionRequestId) {
    try {
        console.log(`🔍 Checking MegaPay status for: ${transactionRequestId}`);
        
        const response = await fetch(MEGAPAY_STATUS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: MEGAPAY_API_KEY,
                email: MEGAPAY_EMAIL,
                transaction_request_id: transactionRequestId
            })
        });

        const responseText = await response.text();
        console.log('📥 MegaPay Status Response:', responseText.substring(0, 500));

        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Failed to parse MegaPay status response');
            return null;
        }

        const isPaid = result.TransactionStatus === 'Completed' ||
                      result.TransactionStatus === 'completed' ||
                      result.TransactionCode === '0' ||
                      result.TransactionCode === 0 ||
                      result.ResultCode === '200' ||
                      result.ResultCode === 200 ||
                      result.success === '200' ||
                      result.success === 200 ||
                      result.status === 'success' ||
                      result.status === 'paid';

        return {
            isPaid: isPaid,
            receipt: result.TransactionReceipt || result.receipt || result.mpesa_code,
            amount: result.TransactionAmount || result.amount,
            status: result.TransactionStatus || result.Status || result.status,
            raw: result
        };

    } catch (error) {
        console.error('❌ Status check error:', error);
        return null;
    }
}

// ─── STK PUSH ENDPOINT ──────────────────────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    
    try {
        const { phone, amount, order_id, order_ref } = req.body;

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

        const kvReference = generateTransactionReference();
        const orderRef = order_ref || generateOrderRef();

        // ─── UPDATE ORDER ──────────────────────────────────────────
        await supabase
            .from('orders')
            .update({
                order_ref: orderRef,
                payment_reference: kvReference,
                provider_reference: kvReference,
                payment_status: 'pending',
                status: 'pending',
                payment_confirmed: false,
                payment_verified: false,
                admin_required: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', order_id);

        // ─── SEND TO MEGAPAY ──────────────────────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: numericAmount.toString(),
            msisdn: formattedPhone,
            reference: kvReference
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        let megaPayResult;
        
        try {
            const megaPayResponse = await fetch(MEGAPAY_INITIATE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify(megaPayPayload)
            });

            clearTimeout(timeoutId);
            
            const responseText = await megaPayResponse.text();
            console.log('📥 MegaPay Raw Response:', responseText.substring(0, 500));
            
            try {
                megaPayResult = JSON.parse(responseText);
            } catch (parseError) {
                console.error('❌ Failed to parse MegaPay response');
                return res.status(500).json({
                    success: false,
                    error: 'Invalid response from MegaPay'
                });
            }
        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error('❌ Fetch error:', fetchError);
            return res.status(502).json({
                success: false,
                error: 'Failed to connect to MegaPay: ' + fetchError.message
            });
        }

        console.log('📊 MegaPay Result:', JSON.stringify(megaPayResult));

        // ─── CHECK MEGAPAY RESPONSE ──────────────────────────────
        const successCode = megaPayResult.success;
        const isSuccess = successCode === '200' || successCode === 200 ||
                         successCode === '0' || successCode === 0 ||
                         megaPayResult.ResultCode === '0' || megaPayResult.ResultCode === 0 ||
                         megaPayResult.Status === 'Success' || megaPayResult.status === 'success' ||
                         megaPayResult.success === true || megaPayResult.success === 'true';

        if (isSuccess) {
            const transactionRequestId = megaPayResult.transaction_request_id || 
                                        megaPayResult.TransactionID || 
                                        megaPayResult.TransactionId ||
                                        megaPayResult.transactionId ||
                                        megaPayResult.CheckoutRequestID ||
                                        megaPayResult.reference ||
                                        kvReference;
            
            console.log(`✅ Transaction Request ID: ${transactionRequestId}`);
            
            if (transactionRequestId) {
                await supabase
                    .from('orders')
                    .update({
                        transaction_request_id: transactionRequestId,
                        checkout_request_id: transactionRequestId,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order_id);
            }

            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully. Please complete the transaction on your phone.',
                data: {
                    reference: kvReference,
                    order_id: order_id,
                    order_ref: orderRef,
                    status: 'pending',
                    phone: formattedPhone,
                    transaction_request_id: transactionRequestId || kvReference
                }
            });
        } else {
            const errorMessage = megaPayResult.massage || megaPayResult.message || 'MegaPay error';
            console.error('❌ MegaPay error:', errorMessage);
            
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
            
            return res.status(400).json({
                success: false,
                error: errorMessage
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

// ─── VERIFY PAYMENT ──────────────────────────────────────────────
app.post('/api/mpesa/verify-payment', async (req, res) => {
    console.log('🔍 Verify payment request received');
    
    try {
        const { order_id, order_ref, mpesa_code } = req.body;
        
        if (!order_id && !order_ref) {
            return res.status(400).json({
                success: false,
                error: 'Missing order_id or order_ref'
            });
        }
        
        let query = supabase.from('orders').select('*');
        if (order_id) query = query.eq('id', order_id);
        else if (order_ref) query = query.eq('order_ref', order_ref);
        
        const { data: order } = await query.single();
        
        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        console.log(`📊 Order: ${order.order_ref}, status: ${order.status}`);
        
        // ─── CHECK IF ALREADY PAID ──────────────────────────────
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            return res.status(200).json({
                success: true,
                message: 'Order already paid',
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'paid',
                isPaid: true,
                verified: true
            });
        }
        
        // ─── CHECK MEGAPAY STATUS ──────────────────────────────
        let isPaid = false;
        let verified = false;
        
        if (order.transaction_request_id && order.status === 'pending') {
            const statusResult = await checkMegaPayStatus(order.transaction_request_id);
            if (statusResult && statusResult.isPaid) {
                isPaid = true;
                verified = true;
                
                await supabase
                    .from('orders')
                    .update({
                        status: 'paid',
                        payment_status: 'paid',
                        payment_confirmed: true,
                        payment_verified: true,
                        mpesa_code: statusResult.receipt || order.mpesa_code,
                        amount_paid: statusResult.amount || order.total_amount || 0,
                        confirmed_at: new Date().toISOString(),
                        paid_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        admin_required: false
                    })
                    .eq('id', order.id);
                
                await fulfillPurchase(order.id);
            }
        }
        
        // ─── MANUAL VERIFICATION ──────────────────────────────
        if (mpesa_code && !isPaid) {
            // Check for duplicate
            const { data: existingOrder } = await supabase
                .from('orders')
                .select('*')
                .eq('mpesa_code', mpesa_code)
                .neq('id', order.id)
                .maybeSingle();
            
            if (existingOrder) {
                return res.status(400).json({
                    success: false,
                    error: 'This M-PESA transaction has already been used'
                });
            }
            
            await supabase
                .from('orders')
                .update({
                    status: 'verifying',
                    payment_status: 'verifying',
                    mpesa_code: mpesa_code,
                    transaction_code: mpesa_code,
                    mpesa_receipt: mpesa_code,
                    verification_method: 'manual_submission',
                    verification_submitted_at: new Date().toISOString(),
                    admin_required: true,
                    payment_confirmed: false,
                    payment_verified: false,
                    updated_at: new Date().toISOString()
                })
                .eq('id', order.id);
            
            return res.status(200).json({
                success: true,
                message: 'Payment code submitted for admin verification.',
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'verifying',
                admin_required: true,
                isPaid: false,
                verified: false
            });
        }
        
        return res.status(200).json({
            success: true,
            message: isPaid ? 'Payment verified!' : 'Payment is still pending.',
            order_id: order.id,
            order_ref: order.order_ref,
            status: isPaid ? 'paid' : order.status || 'pending',
            isPaid: isPaid,
            verified: verified,
            admin_required: order.admin_required || false
        });
        
    } catch (error) {
        console.error('❌ Verify payment error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── MEGAPAY CALLBACK ──────────────────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 MegaPay Callback received!');
    res.status(200).json({ success: true });

    try {
        const data = req.body;
        const reference = data.TransactionReference || data.reference || data.Reference || 
                         data.order_ref || data.payment_reference || data.CheckoutRequestID;
        
        if (!reference) return;
        
        let order = null;
        const searches = [
            { field: 'payment_reference', value: reference },
            { field: 'provider_reference', value: reference },
            { field: 'order_ref', value: reference },
            { field: 'transaction_request_id', value: reference }
        ];
        
        for (const search of searches) {
            const { data: orderData } = await supabase
                .from('orders')
                .select('*')
                .eq(search.field, search.value)
                .maybeSingle();
            
            if (orderData) {
                order = orderData;
                console.log(`✅ Found order by ${search.field}: ${order.order_ref}`);
                break;
            }
        }
        
        if (!order || order.payment_status === 'paid') return;
        
        const isPaid = data.ResponseCode === 0 || data.ResponseCode === '0' ||
                      data.status === 'success' || data.success === true ||
                      data.TransactionStatus === 'Completed' ||
                      data.ResultCode === '200' || data.ResultCode === 200;
        
        if (isPaid) {
            const transactionReceipt = data.TransactionReceipt || data.receipt || 'N/A';
            
            await supabase
                .from('orders')
                .update({
                    status: 'paid',
                    payment_status: 'paid',
                    payment_confirmed: true,
                    payment_verified: true,
                    mpesa_code: transactionReceipt,
                    transaction_code: transactionReceipt,
                    mpesa_receipt: transactionReceipt,
                    amount_paid: data.TransactionAmount || data.Amount || order.total_amount || 0,
                    confirmed_at: new Date().toISOString(),
                    paid_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    callback_received_at: new Date().toISOString(),
                    admin_required: false
                })
                .eq('id', order.id);

            console.log(`✅ Order ${order.order_ref} marked as PAID by callback`);
            await fulfillPurchase(order.id);
        }

    } catch (error) {
        console.error('❌ Callback error:', error);
    }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ─── ROOT ────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'KenyaVault Payment Server',
        endpoints: {
            stk_push: 'POST /api/mpesa/stk-push',
            verify_payment: 'POST /api/mpesa/verify-payment',
            health: 'GET /api/health'
        }
    });
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: https://kenyavault-api.onrender.com/api/health`);
});

module.exports = app;
