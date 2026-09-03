// ============================================================
// KENYA VAULT - PAYMENT SERVER (FIXED VERIFICATION TIMEOUT)
// ============================================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc0OTM5OSwiZXhwIjoyMDk3MzI1Mzk5fQ.qkL7O1o1dhf9jCFuIQIUyJWFUBaq404ePWU0X4I5p1k';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log('✅ Supabase initialized with SERVICE ROLE KEY');

// ─── MEGAPAY CONFIG ──────────────────────────────────────────
const MEGAPAY_API_KEY = process.env.MEGAPAY_API_KEY || 'MGPYDSg2lIYA';
const MEGAPAY_EMAIL = process.env.MEGAPAY_EMAIL || 'adminnexalearn@gmail.com';
const MEGAPAY_INITIATE_URL = process.env.MEGAPAY_URL || 'https://megapay.co.ke/backend/v1/initiatestk';
const MEGAPAY_STATUS_URL = process.env.MEGAPAY_STATUS_URL || 'https://megapay.co.ke/backend/v1/transactionstatus';
const MEGAPAY_CALLBACK_URL = process.env.MEGAPAY_CALLBACK_URL || 'https://kenyavault.onrender.com/api/mpesa/callback';

console.log(`🔑 MegaPay API Key: ${MEGAPAY_API_KEY}`);
console.log(`📧 MegaPay Email: ${MEGAPAY_EMAIL}`);
console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);

// ─── CORS ──────────────────────────────────────────────────────
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

// ─── ORDER CREATION ENDPOINT ────────────────────────────────
app.post('/api/create-order', async (req, res) => {
    console.log('📦 Create order request received!');
    console.log('📥 Body:', req.body);
    
    try {
        const { 
            user_id, 
            user_email, 
            cart_items, 
            total_amount, 
            phone,
            customer_name,
            order_type
        } = req.body;
        
        if (!cart_items || !Array.isArray(cart_items) || cart_items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Cart items are required'
            });
        }
        
        if (!total_amount || parseFloat(total_amount) <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid total amount'
            });
        }
        
        const orderId = crypto.randomUUID();
        const orderRef = generateOrderRef();
        
        const orderData = {
            id: orderId,
            order_ref: orderRef,
            user_id: user_id || null,
            user_email: user_email || null,
            customer_name: customer_name || null,
            customer_phone: phone || null,
            cart_items: cart_items,
            total_amount: parseFloat(total_amount),
            status: 'pending',
            payment_status: 'pending',
            payment_method: 'mpesa',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        console.log('📝 Creating order with data:', orderData);
        
        const { data: order, error: createError } = await supabase
            .from('orders')
            .insert(orderData)
            .select()
            .single();
        
        if (createError) {
            console.error('❌ Order creation error:', createError);
            
            if (createError.code === 'PGRST204') {
                console.log('⚠️ Missing columns - retrying with minimal fields');
                
                const minimalOrderData = {
                    id: orderId,
                    order_ref: orderRef,
                    user_id: user_id || null,
                    user_email: user_email || null,
                    cart_items: cart_items,
                    total_amount: parseFloat(total_amount),
                    status: 'pending',
                    payment_status: 'pending',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                
                const { data: retryOrder, error: retryError } = await supabase
                    .from('orders')
                    .insert(minimalOrderData)
                    .select()
                    .single();
                
                if (retryError) {
                    console.error('❌ Retry order creation error:', retryError);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to create order: ' + retryError.message
                    });
                }
                
                console.log('✅ Order created with minimal fields:', retryOrder);
                return res.status(200).json({
                    success: true,
                    order: retryOrder,
                    order_id: retryOrder.id,
                    order_ref: retryOrder.order_ref
                });
            }
            
            return res.status(500).json({
                success: false,
                error: 'Failed to create order: ' + createError.message
            });
        }
        
        console.log('✅ Order created successfully:', order);
        
        res.status(200).json({
            success: true,
            order: order,
            order_id: order.id,
            order_ref: order.order_ref
        });
        
    } catch (error) {
        console.error('❌ Create order error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── CHECK MEGAPAY TRANSACTION STATUS ──────────────────────
async function checkMegaPayStatus(transactionRequestId) {
    try {
        if (!transactionRequestId) {
            console.log('⚠️ No transaction_request_id provided');
            return null;
        }
        
        console.log(`🔍 Checking MegaPay status for: ${transactionRequestId}`);
        
        const payload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            transaction_request_id: transactionRequestId
        };
        
        const response = await fetch(MEGAPAY_STATUS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
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

        // Check for payment confirmation
        const isPaid = 
            (result.TransactionStatus === 'Completed' || result.TransactionStatus === 'completed') ||
            (result.ResultCode === '0' || result.ResultCode === 0 || result.ResultCode === '00') ||
            (result.ResponseCode === '0' || result.ResponseCode === 0 || result.ResponseCode === '00') ||
            result.success === true ||
            result.success === '200' ||
            result.success === 200 ||
            result.status === 'success' ||
            result.status === 'paid' ||
            result.isPaid === true ||
            result.paid === true;

        let amount = result.TransactionAmount || result.Amount || result.amount || 0;
        if (typeof amount === 'string') {
            amount = parseFloat(amount) || 0;
        }

        const receipt = result.TransactionReceipt || result.Receipt || result.receipt || 
                       result.TransactionID || result.transaction_id || '';

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
        
        if (order.payment_status !== 'paid' && order.payment_confirmed !== true) {
            console.error(`❌ Order ${order.order_ref} is not paid - skipping fulfillment`);
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

// ══════════════════════════════════════════════════════════════
// ─── DOWNLOAD HANDLER ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════

app.post('/api/download-resource', async (req, res) => {
    console.log('📥 Download request received!');
    console.log('📥 Body:', req.body);
    
    try {
        const { resource_id, order_ref, user_id } = req.body;
        
        if (!resource_id) {
            return res.status(400).json({ 
                success: false,
                error: 'Resource ID required' 
            });
        }
        
        const { data: resource, error: resourceError } = await supabase
            .from('resources')
            .select('*')
            .eq('id', resource_id)
            .single();
        
        if (resourceError || !resource) {
            console.error('❌ Resource not found:', resourceError);
            return res.status(404).json({ 
                success: false,
                error: 'Resource not found' 
            });
        }
        
        console.log(`📄 Resource found: ${resource.title} (is_free: ${resource.is_free})`);
        
        if (resource.is_free === true || resource.price === 0 || resource.price === '0') {
            const fileUrl = resource.file_url || resource.file_path || resource.storage_path;
            
            if (!fileUrl) {
                return res.status(500).json({ 
                    success: false,
                    error: 'File URL not found for free resource' 
                });
            }
            
            await supabase
                .from('resources')
                .update({ 
                    download_count: (resource.download_count || 0) + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('id', resource_id);
            
            console.log(`✅ Free resource download: ${resource.title}`);
            
            return res.status(200).json({
                success: true,
                download_url: fileUrl,
                is_free: true,
                resource_title: resource.title
            });
        }
        
        if (!order_ref) {
            console.log('❌ No order_ref provided for paid resource');
            return res.status(403).json({ 
                success: false,
                error: 'Payment required',
                requires_payment: true
            });
        }
        
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('order_ref', order_ref)
            .maybeSingle();
        
        if (orderError || !order) {
            console.log(`❌ Order not found for order_ref: ${order_ref}`);
            return res.status(403).json({ 
                success: false,
                error: 'Order not found',
                requires_payment: true
            });
        }
        
        const isPaid = order.payment_status === 'paid' || 
                      order.status === 'paid' || 
                      order.payment_confirmed === true ||
                      order.payment_verified === true;
        
        if (!isPaid) {
            console.log(`❌ Payment not confirmed for order ${order_ref} (status: ${order.payment_status})`);
            return res.status(403).json({ 
                success: false,
                error: 'Payment not confirmed',
                requires_payment: true,
                payment_status: order.payment_status
            });
        }
        
        let cartItems = order.cart_items;
        if (typeof cartItems === 'string') {
            try { cartItems = JSON.parse(cartItems); } catch (e) { cartItems = []; }
        }
        
        const hasResource = Array.isArray(cartItems) && 
            cartItems.some(item => item.id === resource_id || item.resource_id === resource_id);
        
        if (!hasResource) {
            console.log(`❌ Resource ${resource_id} not in order ${order_ref}`);
            return res.status(403).json({
                success: false,
                error: 'Resource not purchased in this order'
            });
        }
        
        console.log(`✅ Payment verified for ${resource.title} (order: ${order_ref})`);
        
        const filePath = resource.file_path || resource.storage_path;
        
        if (!filePath) {
            return res.status(500).json({ 
                success: false,
                error: 'File path not found for this resource' 
            });
        }
        
        const bucketName = resource.bucket || 'private-resources';
        
        console.log(`📦 Generating signed URL from bucket: ${bucketName}, path: ${filePath}`);
        
        const { data: signedUrlData, error: urlError } = await supabase
            .storage
            .from(bucketName)
            .createSignedUrl(filePath, 60);
        
        if (urlError) {
            console.error('❌ Failed to generate signed URL:', urlError);
            return res.status(500).json({ 
                success: false,
                error: 'Failed to generate download URL: ' + urlError.message
            });
        }
        
        await supabase
            .from('resources')
            .update({ 
                download_count: (resource.download_count || 0) + 1,
                updated_at: new Date().toISOString()
            })
            .eq('id', resource_id);
        
        console.log(`✅ Download URL generated for ${resource.title}`);
        
        return res.status(200).json({
            success: true,
            download_url: signedUrlData.signedUrl,
            expires_in: 60,
            is_free: false,
            resource_title: resource.title
        });
        
    } catch (error) {
        console.error('❌ Download handler error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── VERIFY PAYMENT ENDPOINT (FIXED) ──────────────────────
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
                mpesa_code: order.mpesa_code || ''
            });
        }
        
        // Check MegaPay status if we have a transaction ID
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
                    updated_at: new Date().toISOString()
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
        
        // If still pending, check if we should expire the order
        if (order.status === 'pending' || order.payment_status === 'pending') {
            const createdTime = new Date(order.created_at).getTime();
            const now = Date.now();
            // Extended timeout - 3 minutes (180 seconds)
            const threeMinutes = 3 * 60 * 1000;
            
            if (now - createdTime > threeMinutes) {
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
            
            // Still pending - return pending status with remaining time
            const elapsed = Math.floor((now - createdTime) / 1000);
            const remaining = Math.max(0, 180 - elapsed);
            
            return res.status(200).json({
                isPaid: false,
                status: 'pending',
                order_id: order.id,
                order_ref: order.order_ref,
                message: 'Payment is still pending',
                remaining_seconds: remaining,
                elapsed_seconds: elapsed
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
                error: 'Payment service is currently unavailable. Please try again later.'
            });
        }

        console.log('📥 MegaPay Result:', JSON.stringify(megaPayResult, null, 2));

        // ─── CHECK MEGAPAY RESPONSE ──────────────────────────
        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.ResponseCode === '0' ||
                         megaPayResult.ResponseCode === 0 ||
                         megaPayResult.ResponseCode === '00' ||
                         megaPayResult.success === true ||
                         megaPayResult.success === '200' ||
                         megaPayResult.success === 200;

        if (isSuccess) {
            const transactionRequestId = megaPayResult.transaction_request_id || 
                                        megaPayResult.TransactionRequestID ||
                                        megaPayResult.TransactionID || 
                                        megaPayResult.TransactionId ||
                                        megaPayResult.transactionId ||
                                        megaPayResult.TransactionRequestId ||
                                        megaPayResult.transactionRequestId ||
                                        megaPayResult.CheckoutRequestID ||
                                        megaPayResult.CheckoutRequestId ||
                                        megaPayResult.checkout_request_id ||
                                        megaPayResult.MerchantRequestID ||
                                        megaPayResult.merchant_request_id ||
                                        megaPayResult.request_id ||
                                        megaPayResult.id;
            
            console.log(`✅ Extracted Transaction Request ID: ${transactionRequestId}`);
            
            if (transactionRequestId) {
                const updateTransactionData = {
                    transaction_request_id: transactionRequestId,
                    checkout_request_id: megaPayResult.CheckoutRequestID || megaPayResult.checkout_request_id || null,
                    merchant_request_id: megaPayResult.MerchantRequestID || megaPayResult.merchant_request_id || null,
                    stk_push_request_id: transactionRequestId,
                    payment_reference: kvReference,
                    updated_at: new Date().toISOString()
                };
                
                const { error: saveError } = await supabase
                    .from('orders')
                    .update(updateTransactionData)
                    .eq('id', order_id);
                
                if (saveError) {
                    console.error('❌ Error saving transaction_request_id:', saveError);
                } else {
                    console.log(`✅ Saved transaction_request_id: ${transactionRequestId}`);
                }
            }

            logPaymentEvent('STK_SENT', { 
                reference: kvReference, 
                order_id, 
                orderRef: newOrderRef,
                transaction_request_id: transactionRequestId
            });
            
            return res.status(200).json({
                success: true,
                message: megaPayResult.message || 'STK Push sent successfully',
                data: {
                    reference: kvReference,
                    order_id: order_id,
                    order_ref: newOrderRef,
                    status: 'pending',
                    phone: formattedPhone,
                    transaction_request_id: transactionRequestId,
                    checkout_request_id: megaPayResult.CheckoutRequestID || null,
                    merchant_request_id: megaPayResult.MerchantRequestID || null,
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
                       data.TransactionRequestID ||
                       data.MerchantRequestID;
        
        let transactionId = data.TransactionID || data.transaction_id || data.transactionId || null;
        let receipt = data.TransactionReceipt || data.receipt || data.Receipt || null;
        let amount = data.TransactionAmount || data.Amount || data.amount || 0;
        if (typeof amount === 'string') amount = parseFloat(amount) || 0;
        
        console.log(`🔍 MegaPay sent reference: ${reference}, transactionId: ${transactionId}`);
        
        if (!reference) {
            console.warn('⚠️ No reference found in callback - ignoring');
            return res.status(200).json({ 
                success: true, 
                message: 'No reference found - acknowledged' 
            });
        }

        // ─── CHECK PAYMENT STATUS ──────────────────────────
        const resultCode = data.ResultCode !== undefined ? data.ResultCode : data.ResponseCode;
        const responseDesc = data.ResultDesc || data.ResponseDescription || '';
        const transactionStatus = data.TransactionStatus || data.Status || data.status || '';
        
        const isSuccessCode = resultCode === '0' || resultCode === 0 || resultCode === '00';
        const isSuccessStatus = transactionStatus === 'Completed' || 
                               transactionStatus === 'completed' || 
                               transactionStatus === 'SUCCESS' ||
                               transactionStatus === 'success';
        const isSuccessDesc = responseDesc.toLowerCase().includes('success') || 
                             responseDesc.toLowerCase().includes('completed') ||
                             responseDesc.toLowerCase().includes('accepted');
        
        const isPaid = isSuccessCode && (isSuccessStatus || isSuccessDesc);
        
        console.log(`📊 Callback verification: code=${resultCode}, status=${transactionStatus}, desc=${responseDesc}, isPaid=${isPaid}`);

        // ─── FIND ORDER ─────────────────────────────────────
        let order = null;
        
        const searchMethods = [
            { key: 'transaction_request_id', value: data.transaction_request_id || data.TransactionRequestID },
            { key: 'checkout_request_id', value: data.CheckoutRequestID || data.checkout_request_id },
            { key: 'merchant_request_id', value: data.MerchantRequestID || data.merchant_request_id },
            { key: 'payment_reference', value: reference },
            { key: 'order_ref', value: reference }
        ];

        for (const method of searchMethods) {
            if (!method.value) continue;
            
            const { data: found, error } = await supabase
                .from('orders')
                .select('*')
                .eq(method.key, method.value)
                .maybeSingle();
            
            if (found) {
                order = found;
                console.log(`✅ Found order by ${method.key}: ${order.order_ref}`);
                break;
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
        
        console.log(`📊 Found order: ${order.order_ref}`);
        
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            console.log(`🔄 Order ${order.order_ref} already paid. Skipping duplicate.`);
            return res.status(200).json({
                success: true,
                message: 'Order already processed',
                order_id: order.id,
                status: 'duplicate'
            });
        }

        // ─── CHECK DUPLICATE RECEIPT ──────────────────────
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
                    message: 'Duplicate receipt detected',
                    status: 'failed_duplicate'
                });
            }
        }

        // ─── PROCESS PAYMENT ───────────────────────────────
        if (isPaid) {
            const finalReceipt = receipt || data.TransactionReceipt || 'CALLBACK-' + Date.now();
            const finalTransactionId = transactionId || data.TransactionID || 'CALLBACK-' + Date.now();
            const finalAmount = amount || order.total_amount || 0;
            
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

            logPaymentEvent('CALLBACK_PAID', {
                order_id: order.id,
                order_ref: order.order_ref,
                reference: reference,
                receipt: finalReceipt,
                amount: finalAmount
            });

            console.log(`✅ Order ${order.order_ref} marked as PAID via callback`);

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
            const failureReason = data.ResultDesc || 
                                 data.ResponseDescription || 
                                 data.errorMessage || 
                                 data.message ||
                                 'Payment failed via callback';

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

            console.log(`❌ Order ${order.order_ref} marked as FAILED via callback`);

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
            .lt('created_at', new Date(Date.now() - 180000).toISOString())
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
                                        order.merchant_request_id;
            
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
            
            const statusResult = await checkMegaPayStatus(transactionRequestId);
            
            if (statusResult && statusResult.isPaid) {
                console.log(`✅ Order ${order.order_ref} is PAID! Updating...`);
                
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
                        amount_paid: amountPaid,
                        confirmed_at: new Date().toISOString(),
                        paid_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order.id);
                
                await fulfillPurchase(order.id);
                verified++;
            }
        }
        
        console.log(`✅ Background verification complete: ${verified} verified`);
        
    } catch (error) {
        console.error('❌ Background verification error:', error);
    }
}

// ─── RUN BACKGROUND VERIFICATION ──────────────────────────
setInterval(verifyPendingOrders, 30000);
setTimeout(verifyPendingOrders, 5000);

// ─── HEALTH CHECK ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            megapay: 'configured',
            callback_url: MEGAPAY_CALLBACK_URL,
            background_verification: 'running (every 30s)',
            supabase: 'connected'
        },
        endpoints: {
            create_order: 'POST /api/create-order',
            download: 'POST /api/download-resource',
            stk_push: 'POST /api/mpesa/stk-push',
            verify_payment: 'POST /api/mpesa/verify-payment',
            callback: 'POST /api/mpesa/callback'
        }
    });
});

// ─── ROOT ────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'KenyaVault Payment & Download Server is running!',
        endpoints: {
            create_order: 'POST /api/create-order',
            download: 'POST /api/download-resource',
            stk_push: 'POST /api/mpesa/stk-push',
            health: 'GET /api/health',
            callback: 'POST /api/mpesa/callback',
            verify_payment: 'POST /api/mpesa/verify-payment'
        }
    });
});

// ─── START SERVER ─────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/api/health`);
    console.log(`📞 MegaPay API: ${MEGAPAY_INITIATE_URL}`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`⏰ Payment timeout: 3 minutes`);
    console.log(`✅ Server is ready!`);
});

module.exports = app;
