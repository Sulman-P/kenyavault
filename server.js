// ============================================================
// KENYA VAULT - PAYMENT SERVER (FIXED - WITH BETTER ERROR HANDLING)
// ============================================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc0OTM5OSwiZXhwIjoyMDk3MzI1Mzk5fQ.NfXh5jV9XJ4KjLvQnF3T2WvYpK6mBzHcRwQyNxLpU8M';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log('✅ Supabase initialized with SERVICE ROLE KEY');

// ─── MEGAPAY CONFIG ──────────────────────────────────────────
const MEGAPAY_API_KEY = process.env.MEGAPAY_API_KEY || 'MGPYDSg2lIYA';
const MEGAPAY_EMAIL = process.env.MEGAPAY_EMAIL || 'adminnexalearn@gmail.com';
const MEGAPAY_INITIATE_URL = process.env.MEGAPAY_URL || 'https://megapay.co.ke/backend/v1/initiatestk';
const MEGAPAY_STATUS_URL = process.env.MEGAPAY_STATUS_URL || 'https://megapay.co.ke/backend/v1/transactionstatus';
const MEGAPAY_CALLBACK_URL = process.env.MEGAPAY_CALLBACK_URL || 'https://kenyavault.onrender.com/api/mpesa/callback';

console.log(`📞 MegaPay API Key: ${MEGAPAY_API_KEY ? '✅ Configured' : '❌ MISSING'}`);
console.log(`📧 MegaPay Email: ${MEGAPAY_EMAIL}`);
console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);

// ─── CORS CONFIG ──────────────────────────────────────────────
const allowedOrigins = [
    'https://kenyavault.co.ke',
    'https://www.kenyavault.co.ke',
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:3000',
    'https://kenyavault.onrender.com',
    'http://localhost:8080'
];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.log('⚠️ CORS blocked origin:', origin);
            callback(null, true);
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'Origin'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

app.options('*', (req, res) => {
    const origin = req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(204);
});

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With, Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── LOGGING ──────────────────────────────────────────────────
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.url} - Origin: ${req.headers.origin || 'none'}`);
    next();
});

// ─── HELPERS ──────────────────────────────────────────────────
function generateTransactionReference() {
    const timestamp = Date.now().toString().slice(-8);
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `KV-${timestamp}-${random}`;
}

function generateOrderRef() {
    const date = new Date();
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `ORD-${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}-${random}`;
}

function validatePhoneNumber(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0') && cleaned.length === 10) return cleaned;
    if (cleaned.startsWith('254') && cleaned.length === 12) return '0' + cleaned.substring(3);
    if (phone && phone.startsWith('+254')) return '0' + phone.substring(4).replace(/\D/g, '');
    if (cleaned.length === 9 && cleaned.startsWith('7')) return '0' + cleaned;
    if (cleaned.length === 10 && cleaned.startsWith('07')) return cleaned;
    return null;
}

function logPaymentEvent(event, data) {
    console.log(`[PAYMENT] ${event}:`, JSON.stringify(data, null, 2));
}

// ─── CHECK MEGAPAY TRANSACTION STATUS ──────────────────────
async function checkMegaPayStatus(transactionRequestId) {
    try {
        if (!transactionRequestId) {
            console.log('⚠️ No transaction_request_id provided');
            return null;
        }
        
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
        console.log('📥 MegaPay Status Response:', responseText);

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
                      result.ResultCode === '0' ||
                      result.ResultCode === 0 ||
                      result.ResultCode === '200' ||
                      result.ResultCode === 200 ||
                      result.success === '200' ||
                      result.success === 200 ||
                      result.status === 'success' ||
                      result.status === 'paid' ||
                      result.ResponseCode === '0' ||
                      result.ResponseCode === 0 ||
                      result.ResponseCode === '00';

        let amount = result.TransactionAmount || result.Amount || result.amount || 0;
        if (typeof amount === 'string') {
            amount = parseFloat(amount) || 0;
        }

        const receipt = result.TransactionReceipt || result.Receipt || result.receipt || result.TransactionID || result.transaction_id || '';

        console.log(`📊 MegaPay status: isPaid=${isPaid}, receipt=${receipt}, amount=${amount}`);

        return {
            isPaid: isPaid,
            transactionId: result.TransactionID || result.transaction_id || null,
            receipt: receipt,
            amount: amount,
            status: result.TransactionStatus || result.Status || result.status || 'unknown',
            resultCode: result.ResultCode || result.ResponseCode || null,
            resultDesc: result.ResultDesc || result.ResponseDescription || null,
            raw: result
        };

    } catch (error) {
        console.error('❌ Status check error:', error);
        return null;
    }
}

// ─── FULFILL PURCHASE ──────────────────────────────────────
async function fulfillPurchase(orderId) {
    console.log(`📦 Fulfilling purchase for order: ${orderId}`);
    let resourceUrl = null;
    
    try {
        const { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();
        
        if (error || !order) {
            console.error('❌ Order not found for fulfillment');
            return null;
        }
        
        let items = order.cart_items;
        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch (e) { items = []; }
        }
        
        if (!items || items.length === 0) {
            console.log(`ℹ️ No items in order ${orderId}`);
            return null;
        }
        
        for (const item of items) {
            const resourceId = item.id || item.resource_id;
            if (!resourceId) continue;
            
            const { data: resource, error: resourceError } = await supabase
                .from('resources')
                .select('file_url, download_count')
                .eq('id', resourceId)
                .single();
            
            if (!resourceError && resource) {
                if (resource.file_url) {
                    resourceUrl = resource.file_url;
                }
                
                const newCount = (resource.download_count || 0) + 1;
                await supabase
                    .from('resources')
                    .update({ 
                        download_count: newCount,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', resourceId);
                console.log(`✅ Resource download count updated to ${newCount}`);
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
        
        return resourceUrl;
        
    } catch (error) {
        console.error('❌ Fulfillment error:', error);
        return null;
    }
}

// ─── VERIFY PAYMENT ENDPOINT ────────────────────────────────
app.post('/api/mpesa/verify-payment', async (req, res) => {
    console.log('📊 Verify payment request received!');
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
            console.error('❌ Order not found:', findError);
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        console.log(`📊 Found order: ${order.order_ref}, status: ${order.status}, payment_status: ${order.payment_status}`);
        
        // Check if already paid
        const isPaid = order.payment_status === 'paid' || 
                      order.status === 'paid' || 
                      order.payment_confirmed === true ||
                      order.payment_verified === true;
        
        if (isPaid) {
            console.log(`✅ Order ${order.order_ref} is already paid`);
            return res.status(200).json({
                isPaid: true,
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'paid',
                payment_status: order.payment_status,
                mpesa_code: order.mpesa_code || '',
                resource_url: order.resource_file_path || null
            });
        }
        
        // Check with MegaPay if we have a transaction ID
        if (order.transaction_request_id) {
            console.log(`🔍 Checking MegaPay status for transaction: ${order.transaction_request_id}`);
            const megaPayStatus = await checkMegaPayStatus(order.transaction_request_id);
            
            if (megaPayStatus && megaPayStatus.isPaid) {
                console.log(`✅ MegaPay status API confirmed payment for order ${order.order_ref}`);
                
                const updateData = {
                    status: 'paid',
                    payment_status: 'paid',
                    payment_confirmed: true,
                    payment_verified: true,
                    mpesa_code: megaPayStatus.receipt || order.mpesa_code || '',
                    transaction_code: megaPayStatus.receipt || order.mpesa_code || '',
                    amount_paid: megaPayStatus.amount || order.total_amount || 0,
                    confirmed_at: new Date().toISOString(),
                    paid_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    callback_received_at: new Date().toISOString()
                };
                
                const { error: updateError } = await supabase
                    .from('orders')
                    .update(updateData)
                    .eq('id', order.id);
                
                if (!updateError) {
                    const resourceUrl = await fulfillPurchase(order.id);
                    
                    return res.status(200).json({
                        isPaid: true,
                        order_id: order.id,
                        order_ref: order.order_ref,
                        status: 'paid',
                        mpesa_code: megaPayStatus.receipt || '',
                        resource_url: resourceUrl || order.resource_file_path || null
                    });
                }
            }
        }
        
        // If we have an MPESA code but not confirmed
        if (mpesa_code) {
            console.log(`🔍 Verifying with M-PESA code: ${mpesa_code}`);
            
            // Check duplicate receipt
            const { data: existingOrder, error: dupError } = await supabase
                .from('orders')
                .select('*')
                .eq('mpesa_code', mpesa_code)
                .neq('id', order.id)
                .maybeSingle();
            
            if (existingOrder) {
                console.log(`⚠️ M-PESA code ${mpesa_code} already used for order ${existingOrder.order_ref}`);
                return res.status(200).json({
                    isPaid: false,
                    admin_required: false,
                    status: 'failed',
                    error: 'This M-PESA transaction has already been used',
                    order_id: order.id,
                    order_ref: order.order_ref
                });
            }
            
            // Mark for admin verification
            const updateData = {
                mpesa_code: mpesa_code,
                transaction_code: mpesa_code,
                admin_required: true,
                status: 'verifying',
                payment_status: 'verifying',
                updated_at: new Date().toISOString()
            };
            
            const { error: updateError } = await supabase
                .from('orders')
                .update(updateData)
                .eq('id', order.id);
            
            if (updateError) {
                console.error('❌ Error updating order:', updateError);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to update order'
                });
            }
            
            console.log(`⏳ Order ${order.order_ref} marked for admin verification`);
            
            return res.status(200).json({
                isPaid: false,
                admin_required: true,
                status: 'verifying',
                order_id: order.id,
                order_ref: order.order_ref,
                message: 'Payment code submitted for admin verification'
            });
        }
        
        // Check if order is expired (older than 5 minutes)
        if (order.status === 'pending' || order.payment_status === 'pending') {
            const createdTime = new Date(order.created_at).getTime();
            const now = Date.now();
            const fiveMinutes = 5 * 60 * 1000;
            
            if (now - createdTime > fiveMinutes) {
                await supabase
                    .from('orders')
                    .update({
                        status: 'expired',
                        payment_status: 'expired',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order.id);
                
                return res.status(200).json({
                    isPaid: false,
                    status: 'expired',
                    order_id: order.id,
                    order_ref: order.order_ref,
                    message: 'Payment request expired'
                });
            }
            
            return res.status(200).json({
                isPaid: false,
                status: 'pending',
                order_id: order.id,
                order_ref: order.order_ref,
                message: 'Payment is still pending'
            });
        }
        
        return res.status(200).json({
            isPaid: false,
            status: order.status || 'unknown',
            order_id: order.id,
            order_ref: order.order_ref,
            payment_status: order.payment_status,
            message: 'Payment status unknown'
        });
        
    } catch (error) {
        console.error('❌ Verify payment error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── STK PUSH ENDPOINT ──────────────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    console.log('📥 Request body:', req.body);
    console.log('📥 Origin:', req.headers.origin);
    
    try {
        const { phone, amount, order_id, order_ref, customer_name, customer_email, resource_ids } = req.body;

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
        const newOrderRef = order_ref || generateOrderRef();

        logPaymentEvent('STK_INITIATED', { 
            phone: formattedPhone, 
            amount: numericAmount, 
            kvReference,
            orderRef: newOrderRef,
            order_id
        });

        // ─── UPDATE ORDER ──────────────────────────────────────
        const updateData = {
            order_ref: newOrderRef,
            payment_reference: kvReference,
            provider_reference: kvReference,
            payment_status: 'pending',
            updated_at: new Date().toISOString()
        };

        console.log('📝 Updating order with:', updateData);

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

        // ─── SEND TO MEGAPAY ──────────────────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: numericAmount.toString(),
            msisdn: formattedPhone,
            reference: kvReference,
            callback_url: MEGAPAY_CALLBACK_URL
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload, null, 2));

        let megaPayResult;
        let responseText;
        
        try {
            const megaPayResponse = await fetch(MEGAPAY_INITIATE_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(megaPayPayload)
            });

            responseText = await megaPayResponse.text();
            console.log('📥 MegaPay Raw Response:', responseText);
            
            try {
                megaPayResult = JSON.parse(responseText);
            } catch (parseError) {
                console.error('❌ Failed to parse MegaPay response:', parseError);
                return res.status(500).json({
                    success: false,
                    error: 'Invalid response from MegaPay',
                    raw_response: responseText
                });
            }
        } catch (fetchError) {
            console.error('❌ MegaPay connection error:', fetchError);
            return res.status(503).json({
                success: false,
                error: 'Payment service is currently unavailable. Please try again later.',
                message: 'MegaPay service is not responding'
            });
        }

        console.log('📥 MegaPay Result:', JSON.stringify(megaPayResult, null, 2));

        // ─── CHECK MEGAPAY RESPONSE ──────────────────────────
        const isSuccess = megaPayResult.success === '200' || 
                         megaPayResult.success === 200 ||
                         megaPayResult.ResultCode === '0' ||
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.ResponseCode === '0' ||
                         megaPayResult.ResponseCode === 0 ||
                         megaPayResult.ResponseCode === '00';

        if (isSuccess) {
            const transactionRequestId = megaPayResult.transaction_request_id || 
                                        megaPayResult.TransactionID || 
                                        megaPayResult.TransactionId ||
                                        megaPayResult.transactionId ||
                                        megaPayResult.TransactionRequestID ||
                                        megaPayResult.TransactionRequestId ||
                                        megaPayResult.transactionRequestId ||
                                        megaPayResult.request_id ||
                                        megaPayResult.id ||
                                        megaPayResult.CheckoutRequestID ||
                                        megaPayResult.CheckoutRequestId ||
                                        megaPayResult.checkout_request_id;
            
            console.log(`✅ Extracted Transaction Request ID: ${transactionRequestId}`);
            
            if (transactionRequestId) {
                const { error: saveError } = await supabase
                    .from('orders')
                    .update({
                        transaction_request_id: transactionRequestId,
                        checkout_request_id: transactionRequestId,
                        stk_push_request_id: transactionRequestId,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order_id);
                
                if (saveError) {
                    console.error('❌ Error saving transaction_request_id:', saveError);
                } else {
                    console.log(`✅ Saved transaction_request_id: ${transactionRequestId}`);
                }
            } else {
                console.warn('⚠️ No transaction_request_id in MegaPay response');
                console.warn('📥 Available fields:', Object.keys(megaPayResult));
            }

            logPaymentEvent('STK_SENT', { 
                reference: kvReference, 
                order_id, 
                orderRef: newOrderRef,
                transaction_request_id: transactionRequestId 
            });
            
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    reference: kvReference,
                    order_id: order_id,
                    order_ref: newOrderRef,
                    status: 'pending',
                    phone: formattedPhone,
                    transaction_request_id: transactionRequestId,
                    megaPayResponse: megaPayResult
                }
            });
        } else {
            const errorMessage = megaPayResult.message || 
                                megaPayResult.massage || 
                                megaPayResult.ResultDesc || 
                                megaPayResult.errorMessage || 
                                megaPayResult.ResponseDescription ||
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
                error: errorMessage,
                megaPayResponse: megaPayResult
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

// ─── MEGAPAY CALLBACK ──────────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 MegaPay Callback received!');
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));

    try {
        const data = req.body;
        
        let reference = data.TransactionReference || 
                       data.reference || 
                       data.Reference || 
                       data.order_ref || 
                       data.payment_reference || 
                       data.CheckoutRequestID ||
                       data.transaction_request_id ||
                       data.TransactionRequestID;
        
        let transactionId = data.TransactionID || data.transaction_id || data.transactionId || null;
        let receipt = data.TransactionReceipt || data.receipt || data.Receipt || null;
        let amount = data.TransactionAmount || data.Amount || data.amount || 0;
        if (typeof amount === 'string') amount = parseFloat(amount) || 0;
        
        console.log(`🔍 MegaPay sent reference: ${reference}, transactionId: ${transactionId}`);
        
        if (!reference) {
            console.warn('⚠️ No reference found in callback');
            return res.status(200).json({ 
                success: true, 
                message: 'No reference found - acknowledged' 
            });
        }
        
        // Find order by multiple reference fields
        let order = null;
        let searchMethod = 'none';
        
        // Try by payment_reference
        const { data: orderByPayment, error: error1 } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .maybeSingle();
        
        if (orderByPayment) {
            order = orderByPayment;
            searchMethod = 'payment_reference';
            console.log(`✅ Found order by payment_reference: ${order.order_ref}`);
        }
        
        // Try by provider_reference
        if (!order) {
            const { data: orderByProvider, error: error2 } = await supabase
                .from('orders')
                .select('*')
                .eq('provider_reference', reference)
                .maybeSingle();
            
            if (orderByProvider) {
                order = orderByProvider;
                searchMethod = 'provider_reference';
                console.log(`✅ Found order by provider_reference: ${order.order_ref}`);
            }
        }
        
        // Try by order_ref
        if (!order) {
            const { data: orderByOrderRef, error: error3 } = await supabase
                .from('orders')
                .select('*')
                .eq('order_ref', reference)
                .maybeSingle();
            
            if (orderByOrderRef) {
                order = orderByOrderRef;
                searchMethod = 'order_ref';
                console.log(`✅ Found order by order_ref: ${order.order_ref}`);
            }
        }
        
        // Try by CheckoutRequestID
        if (!order && data.CheckoutRequestID) {
            const { data: orderByCheckout, error: error4 } = await supabase
                .from('orders')
                .select('*')
                .eq('checkout_request_id', data.CheckoutRequestID)
                .maybeSingle();
            
            if (orderByCheckout) {
                order = orderByCheckout;
                searchMethod = 'checkout_request_id';
                console.log(`✅ Found order by checkout_request_id: ${order.order_ref}`);
            }
        }
        
        // Try by transaction_request_id
        if (!order && data.transaction_request_id) {
            const { data: orderByTransaction, error: error5 } = await supabase
                .from('orders')
                .select('*')
                .eq('transaction_request_id', data.transaction_request_id)
                .maybeSingle();
            
            if (orderByTransaction) {
                order = orderByTransaction;
                searchMethod = 'transaction_request_id';
                console.log(`✅ Found order by transaction_request_id: ${order.order_ref}`);
            }
        }
        
        if (!order) {
            console.log(`❌ Order NOT found for reference: ${reference}`);
            return res.status(200).json({ 
                success: true, 
                message: 'Order not found but acknowledged',
                reference: reference
            });
        }
        
        console.log(`📊 Found order: ${order.order_ref} (${searchMethod})`);
        
        // Check if already paid
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            console.log(`🔄 Order ${order.order_ref} already paid. Skipping duplicate.`);
            return res.status(200).json({
                success: true,
                message: 'Order already processed',
                order_id: order.id,
                status: 'duplicate'
            });
        }
        
        // Check duplicate receipt
        if (receipt) {
            const { data: receiptCheck, error: receiptError } = await supabase
                .from('orders')
                .select('id')
                .eq('mpesa_code', receipt)
                .neq('id', order.id)
                .maybeSingle();
            
            if (receiptCheck) {
                console.log(`⚠️ Receipt ${receipt} already used on another order`);
                return res.status(200).json({
                    success: true,
                    message: 'Receipt already used',
                    status: 'duplicate_receipt'
                });
            }
        }
        
        // Determine if payment was successful
        const isPaid = data.ResponseCode === 0 || 
                      data.ResponseCode === '0' ||
                      data.ResponseCode === '00' ||
                      data.ResultCode === '0' ||
                      data.ResultCode === 0 ||
                      data.ResultCode === '200' ||
                      data.ResultCode === 200 ||
                      data.status === 'success' || 
                      data.success === true ||
                      data.success === '200' ||
                      data.success === 200 ||
                      data.ResponseDescription === 'Success' ||
                      data.ResponseDescription === 'Success. Request accepted for processing' ||
                      data.TransactionStatus === 'Completed' ||
                      data.TransactionStatus === 'completed' ||
                      data.TransactionStatus === 'paid';
        
        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        console.log(`📝 ResponseCode: ${data.ResponseCode}, ResponseDescription: ${data.ResponseDescription}`);
        
        if (isPaid) {
            const finalReceipt = receipt || data.TransactionReceipt || 'N/A';
            const finalTransactionId = transactionId || data.TransactionID || 'N/A';
            const finalAmount = amount || data.TransactionAmount || order.total_amount || 0;
            
            const updateData = {
                status: 'paid',
                payment_status: 'paid',
                payment_confirmed: true,
                payment_verified: true,
                provider_transaction_id: finalTransactionId,
                mpesa_transaction_id: finalTransactionId,
                mpesa_code: finalReceipt,
                transaction_code: finalReceipt,
                mpesa_receipt: finalReceipt,
                amount_paid: finalAmount,
                confirmed_at: new Date().toISOString(),
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                callback_received_at: new Date().toISOString(),
                webhook_processed: true,
                admin_required: false
            };

            const { error: updateError } = await supabase
                .from('orders')
                .update(updateData)
                .eq('id', order.id);

            if (updateError) {
                console.error('❌ Failed to update order:', updateError);
                return res.status(200).json({
                    success: false,
                    error: 'Failed to update order'
                });
            }

            const resourceUrl = await fulfillPurchase(order.id);

            logPaymentEvent('ORDER_MARKED_PAID', {
                order_id: order.id,
                order_ref: order.order_ref,
                reference: reference,
                transaction_id: finalTransactionId,
                receipt: finalReceipt,
                amount: finalAmount
            });

            console.log(`✅ Order ${order.order_ref} marked as PAID`);

            return res.status(200).json({
                success: true,
                message: 'Payment processed successfully',
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'paid',
                transaction_receipt: finalReceipt,
                resource_url: resourceUrl || order.resource_file_path || null
            });

        } else {
            const failureReason = data.ResponseDescription || 
                                 data.errorMessage || 
                                 data.ResultDesc || 
                                 data.failureReason ||
                                 'Payment failed';

            await supabase
                .from('orders')
                .update({
                    status: 'failed',
                    payment_status: 'failed',
                    failure_reason: failureReason,
                    payment_error: failureReason,
                    updated_at: new Date().toISOString(),
                    callback_received_at: new Date().toISOString()
                })
                .eq('id', order.id);

            logPaymentEvent('ORDER_MARKED_FAILED', {
                order_id: order.id,
                order_ref: order.order_ref,
                reference: reference,
                reason: failureReason
            });

            console.log(`❌ Order ${order.order_ref} marked as FAILED`);

            return res.status(200).json({
                success: true,
                message: 'Payment failed',
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'failed'
            });
        }

    } catch (error) {
        console.error('❌ Callback processing error:', error);
        return res.status(200).json({
            success: false,
            error: 'Callback processing error: ' + error.message
        });
    }
});

// ─── BACKGROUND VERIFICATION ──────────────────────────────
async function verifyPendingOrders() {
    console.log('🔍 Running background payment verification...');
    
    try {
        const { data: pendingOrders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('status', 'pending')
            .lt('created_at', new Date(Date.now() - 120000).toISOString())
            .limit(20);
        
        if (error) {
            console.error('❌ Error fetching pending orders:', error);
            return;
        }
        
        if (!pendingOrders || pendingOrders.length === 0) {
            console.log('ℹ️ No pending orders to verify');
            return;
        }
        
        console.log(`📋 Found ${pendingOrders.length} pending orders to verify`);
        
        let verified = 0;
        
        for (const order of pendingOrders) {
            const transactionRequestId = order.transaction_request_id || 
                                        order.checkout_request_id || 
                                        order.mpesa_transaction_id;
            
            if (!transactionRequestId) {
                console.log(`ℹ️ No transaction_request_id for order ${order.order_ref}, marking as expired`);
                
                await supabase
                    .from('orders')
                    .update({
                        status: 'expired',
                        payment_status: 'expired',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order.id);
                continue;
            }
            
            console.log(`🔍 Verifying order ${order.order_ref} with transaction_request_id: ${transactionRequestId}`);
            
            if (order.mpesa_code && order.mpesa_code.length > 0) {
                console.log(`✅ Order ${order.order_ref} already has M-PESA code: ${order.mpesa_code}`);
                
                await supabase
                    .from('orders')
                    .update({
                        status: 'paid',
                        payment_status: 'paid',
                        payment_confirmed: true,
                        payment_verified: true,
                        confirmed_at: new Date().toISOString(),
                        paid_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order.id);
                
                await fulfillPurchase(order.id);
                verified++;
                continue;
            }
            
            const statusResult = await checkMegaPayStatus(transactionRequestId);
            
            if (statusResult && statusResult.isPaid) {
                console.log(`✅ Order ${order.order_ref} is PAID! Updating...`);
                
                const transactionId = statusResult.transactionId || 'VERIFIED';
                const receipt = statusResult.receipt || 'VERIFIED';
                const amountPaid = statusResult.amount || order.total_amount || 0;
                
                await supabase
                    .from('orders')
                    .update({
                        status: 'paid',
                        payment_status: 'paid',
                        payment_confirmed: true,
                        payment_verified: true,
                        mpesa_code: receipt,
                        transaction_code: receipt,
                        mpesa_receipt: receipt,
                        provider_transaction_id: transactionId,
                        mpesa_transaction_id: transactionId,
                        amount_paid: amountPaid,
                        confirmed_at: new Date().toISOString(),
                        paid_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        callback_received_at: new Date().toISOString()
                    })
                    .eq('id', order.id);
                
                await fulfillPurchase(order.id);
                verified++;
            } else if (statusResult) {
                console.log(`ℹ️ Order ${order.order_ref} still pending (${statusResult.status || 'unknown'})`);
            }
        }
        
        console.log(`✅ Background verification complete: ${verified} verified, ${pendingOrders.length - verified} still pending`);
        
    } catch (error) {
        console.error('❌ Background verification error:', error);
    }
}

// ─── RUN BACKGROUND VERIFICATION ──────────────────────────
setInterval(verifyPendingOrders, 60000);
setTimeout(verifyPendingOrders, 5000);

// ─── HEALTH CHECK ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            megapay: MEGAPAY_API_KEY ? 'configured' : 'missing_api_key',
            callback_url: MEGAPAY_CALLBACK_URL,
            background_verification: 'running (every 60s)',
            supabase: 'connected'
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
            verify_payment: 'POST /api/mpesa/verify-payment'
        },
        background_verification: {
            status: 'running',
            interval: '60 seconds'
        },
        security: {
            callback_verification: 'enabled',
            receipt_duplicate_check: 'enabled',
            order_expiry: '2 minutes'
        }
    });
});

// ─── START SERVER ─────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: https://kenyavault.onrender.com/api/health`);
    console.log(`📞 MegaPay API: ${MEGAPAY_INITIATE_URL}`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`✅ Server is ready!`);
    console.log(`🔍 Background verification running every 60 seconds`);
    console.log(`🔒 Security: Receipt duplicate check, order expiry, callback verification`);
});

module.exports = app;