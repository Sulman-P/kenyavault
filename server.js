// ============================================================
// KENYA VAULT - PAYMENT SERVER (RENDER DEPLOYMENT)
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

console.log('✅ Supabase initialized with Service Role Key');

// ─── CORS ──────────────────────────────────────────────────────
app.use(cors({
    origin: [
        'https://kenyavault.co.ke',
        'https://www.kenyavault.co.ke',
        'http://localhost:5500',
        'http://localhost:3000',
        'http://localhost:8080',
        'https://kenyavault.pages.dev',
        '*.pages.dev'
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
const MEGAPAY_CALLBACK_URL = 'https://kenyavault-api.onrender.com/api/mpesa/callback';

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
    if (phone && phone.startsWith('+254')) return '0' + phone.substring(4).replace(/\D/g, '');
    if (cleaned.length === 9 && cleaned.startsWith('7')) return '0' + cleaned;
    return null;
}

function logPaymentEvent(event, data) {
    console.log(`[PAYMENT] ${event}:`, JSON.stringify(data, null, 2));
}

// ─── FULFILL PURCHASE ──────────────────────────────────────────────
async function fulfillPurchase(orderId) {
    console.log(`📦 Fulfilling purchase for order: ${orderId}`);
    try {
        const { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();
        
        if (error || !order) {
            console.error('❌ Order not found for fulfillment');
            return;
        }
        
        if (order.payment_status !== 'paid' && order.payment_confirmed !== true) {
            console.log(`⏳ Order ${orderId} not paid yet. Skipping fulfillment.`);
            return;
        }
        
        let items = order.cart_items;
        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch (e) { items = []; }
        }
        
        if (!items || items.length === 0) {
            console.log(`ℹ️ No items in order ${orderId}`);
            return;
        }
        
        for (const item of items) {
            const resourceId = item.id || item.resource_id;
            if (!resourceId) continue;
            
            const { data: resource, error: resourceError } = await supabase
                .from('resources')
                .select('download_count')
                .eq('id', resourceId)
                .single();
            
            if (!resourceError && resource) {
                const newCount = (resource.download_count || 0) + 1;
                await supabase
                    .from('resources')
                    .update({ download_count: newCount })
                    .eq('id', resourceId);
                console.log(`✅ Download count updated for resource: ${resourceId} -> ${newCount}`);
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
            
        logPaymentEvent('PURCHASE_FULFILLED', { order_id: orderId, items: items.length });
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
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
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
            console.error('❌ Failed to parse MegaPay status response:', e);
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
            transactionId: result.TransactionID || result.transaction_id || result.TransactionId,
            receipt: result.TransactionReceipt || result.receipt || result.mpesa_code,
            amount: result.TransactionAmount || result.amount,
            status: result.TransactionStatus || result.Status || result.status,
            resultCode: result.ResultCode || result.success || result.response_code,
            resultDesc: result.ResultDesc || result.message || result.response_message,
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
    console.log('📥 Request body:', req.body);
    
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
        const updateData = {
            order_ref: orderRef,
            payment_reference: kvReference,
            provider_reference: kvReference,
            payment_status: 'pending',
            status: 'pending',
            payment_confirmed: false,
            payment_verified: false,
            admin_required: false,
            updated_at: new Date().toISOString()
        };

        console.log('📝 Updating order with pending status:', updateData);

        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order_id);

        if (updateError) {
            console.error('❌ Error updating order:', updateError);
            return res.status(500).json({
                success: false,
                error: 'Failed to update order: ' + updateError.message
            });
        }

        // ─── SEND TO MEGAPAY ──────────────────────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: numericAmount.toString(),
            msisdn: formattedPhone,
            reference: kvReference
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload, null, 2));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        let megaPayResult;
        let responseText;
        
        try {
            const megaPayResponse = await fetch(MEGAPAY_INITIATE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                signal: controller.signal,
                body: JSON.stringify(megaPayPayload)
            });

            clearTimeout(timeoutId);
            
            responseText = await megaPayResponse.text();
            console.log('📥 MegaPay Raw Response:', responseText.substring(0, 1000));
            
            try {
                megaPayResult = JSON.parse(responseText);
            } catch (parseError) {
                console.error('❌ Failed to parse MegaPay response:', parseError);
                return res.status(500).json({
                    success: false,
                    error: 'Invalid response from MegaPay'
                });
            }
        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error('❌ Fetch error:', fetchError);
            if (fetchError.name === 'AbortError') {
                return res.status(504).json({
                    success: false,
                    error: 'MegaPay request timed out. Please try again.'
                });
            }
            return res.status(502).json({
                success: false,
                error: 'Failed to connect to MegaPay: ' + fetchError.message
            });
        }

        console.log('📊 MegaPay Result:', JSON.stringify(megaPayResult, null, 2));

        // ─── CHECK MEGAPAY RESPONSE ──────────────────────────────
        const successCode = megaPayResult.success;
        const isSuccess = successCode === '200' || 
                         successCode === 200 ||
                         successCode === '0' ||
                         successCode === 0 ||
                         megaPayResult.ResultCode === '0' ||
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.Status === 'Success' ||
                         megaPayResult.status === 'success' ||
                         megaPayResult.success === true ||
                         megaPayResult.success === 'true';

        if (isSuccess) {
            const transactionRequestId = megaPayResult.transaction_request_id || 
                                        megaPayResult.TransactionID || 
                                        megaPayResult.TransactionId ||
                                        megaPayResult.transactionId ||
                                        megaPayResult.CheckoutRequestID ||
                                        megaPayResult.reference ||
                                        kvReference;
            
            console.log(`✅ Extracted Transaction Request ID: ${transactionRequestId}`);
            
            if (transactionRequestId) {
                await supabase
                    .from('orders')
                    .update({
                        transaction_request_id: transactionRequestId,
                        checkout_request_id: transactionRequestId,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order_id);
                console.log(`✅ Saved transaction_request_id: ${transactionRequestId}`);
            }

            logPaymentEvent('STK_SENT', { 
                reference: kvReference, 
                order_id, 
                orderRef,
                transaction_request_id: transactionRequestId || kvReference
            });
            
            // ─── ORDER REMAINS PENDING ──────────────────────────────
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
            const errorMessage = megaPayResult.massage || 
                                megaPayResult.message ||
                                megaPayResult.ResultDesc || 
                                megaPayResult.errorMessage || 
                                megaPayResult.error ||
                                'Unknown MegaPay error';
            
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
    console.log('📥 Body:', req.body);
    
    try {
        const { order_id, order_ref, mpesa_code } = req.body;
        
        if (!order_id && !order_ref) {
            return res.status(400).json({
                success: false,
                error: 'Missing order_id or order_ref'
            });
        }
        
        let query = supabase.from('orders').select('*');
        if (order_id) {
            query = query.eq('id', order_id);
        } else if (order_ref) {
            query = query.eq('order_ref', order_ref);
        }
        
        const { data: order, error: findError } = await query.single();
        
        if (findError || !order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        console.log(`📊 Order: ${order.order_ref}, status: ${order.status}, payment_status: ${order.payment_status}`);
        
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
        let receipt = null;
        let verified = false;
        
        if (order.transaction_request_id && order.status === 'pending') {
            const statusResult = await checkMegaPayStatus(order.transaction_request_id);
            if (statusResult && statusResult.isPaid) {
                isPaid = true;
                verified = true;
                receipt = statusResult.receipt;
                
                const updateData = {
                    status: 'paid',
                    payment_status: 'paid',
                    payment_confirmed: true,
                    payment_verified: true,
                    mpesa_code: receipt || order.mpesa_code,
                    transaction_code: receipt || order.mpesa_code,
                    mpesa_receipt: receipt || order.mpesa_code,
                    amount_paid: statusResult.amount || order.total_amount || 0,
                    confirmed_at: new Date().toISOString(),
                    paid_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    admin_required: false
                };
                
                await supabase
                    .from('orders')
                    .update(updateData)
                    .eq('id', order.id);
                
                await fulfillPurchase(order.id);
            }
        }
        
        // ─── MANUAL VERIFICATION ──────────────────────────────
        if (mpesa_code && !isPaid) {
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
                message: 'Payment code submitted for verification. Please wait for admin approval.',
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
            message: isPaid ? 'Payment verified successfully!' : 'Payment is still pending.',
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
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));

    res.status(200).json({ success: true, message: 'Callback received' });

    try {
        const data = req.body;
        const reference = data.TransactionReference || data.reference || data.Reference || 
                         data.order_ref || data.payment_reference || data.CheckoutRequestID || 
                         data.MerchantRequestID || data.TransactionID;
        
        if (!reference) {
            console.warn('⚠️ No reference found in callback');
            return;
        }
        
        let order = null;
        const searches = [
            { field: 'payment_reference', value: reference },
            { field: 'provider_reference', value: reference },
            { field: 'order_ref', value: reference },
            { field: 'transaction_request_id', value: reference },
            { field: 'checkout_request_id', value: reference }
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
        
        if (!order) {
            console.log(`❌ Order NOT found for reference: ${reference}`);
            return;
        }
        
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            console.log(`🔄 Order ${order.order_ref} already paid.`);
            return;
        }
        
        const isPaid = data.ResponseCode === 0 || data.ResponseCode === '0' ||
                      data.status === 'success' || data.success === true ||
                      data.TransactionStatus === 'Completed' ||
                      data.ResultCode === '200' || data.ResultCode === 200;
        
        if (isPaid) {
            const transactionReceipt = data.TransactionReceipt || data.receipt || data.mpesa_code || 'N/A';
            const amountPaid = data.TransactionAmount || data.Amount || data.amount || order.total_amount || 0;
            
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
                    amount_paid: amountPaid,
                    confirmed_at: new Date().toISOString(),
                    paid_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    callback_received_at: new Date().toISOString(),
                    webhook_processed: true,
                    admin_required: false
                })
                .eq('id', order.id);

            console.log(`✅ Order ${order.order_ref} marked as PAID by callback`);
            await fulfillPurchase(order.id);
        }

    } catch (error) {
        console.error('❌ Callback processing error:', error);
    }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ─── ROOT ────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'KenyaVault Payment Server is running!',
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
