// ============================================================
// KENYA VAULT - PAYMENT SERVER (SECURE - NO PREMATURE VERIFICATION)
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
        'https://kenyavault.onrender.com'
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
const MEGAPAY_CALLBACK_URL = 'https://kenyavault.onrender.com/api/mpesa/callback';

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
        
        // SAFETY CHECK: Only fulfill if payment is confirmed
        if (order.payment_status !== 'paid' && order.payment_confirmed !== true) {
            console.log(`⏳ Order ${orderId} not paid yet. Skipping fulfillment. Payment status: ${order.payment_status}`);
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

// ─── CHECK MEGAPAY TRANSACTION STATUS ──────────────────────────────
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

        // ONLY mark as paid if MegaPay explicitly says "Completed"
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
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    console.log('🚀 STK Push endpoint called!');
    console.log('📥 Request body:', req.body);
    
    try {
        const { phone, amount, order_id, order_ref, customer_name, customer_email } = req.body;

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

        logPaymentEvent('STK_INITIATED', { 
            phone: formattedPhone, 
            amount: numericAmount, 
            kvReference,
            orderRef,
            order_id
        });

        // ─── UPDATE ORDER - SET TO PENDING ONLY ──────────────────────
        // CRITICAL: Do NOT set any payment confirmation flags here!
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
            // CRITICAL: Do NOT mark as paid here! The order stays pending
            // until MegaPay callback or status check confirms payment.
            
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully. Please complete the transaction on your phone.',
                data: {
                    reference: kvReference,
                    order_id: order_id,
                    order_ref: orderRef,
                    status: 'pending',  // STILL PENDING!
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

// ─── VERIFY PAYMENT STATUS ──────────────────────────────────────────
app.post('/api/mpesa/verify-payment', async (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    
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
        
        // ─── FIND THE ORDER ──────────────────────────────────────
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
        
        console.log(`📊 Order found: ${order.order_ref}, status: ${order.status}, payment_status: ${order.payment_status}`);
        
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
        // Only check if we have a transaction_request_id and the order is pending
        let isPaid = false;
        let receipt = null;
        let amountPaid = 0;
        let verified = false;
        
        if (order.transaction_request_id && order.status === 'pending') {
            console.log(`🔍 Checking MegaPay status for transaction: ${order.transaction_request_id}`);
            const statusResult = await checkMegaPayStatus(order.transaction_request_id);
            
            if (statusResult && statusResult.isPaid) {
                isPaid = true;
                verified = true;
                receipt = statusResult.receipt;
                amountPaid = statusResult.amount || order.total_amount || 0;
                
                console.log(`✅ MegaPay confirms payment for order ${order.order_ref}`);
                
                // ─── UPDATE ORDER AS PAID ──────────────────────────
                const updateData = {
                    status: 'paid',
                    payment_status: 'paid',
                    payment_confirmed: true,
                    payment_verified: true,
                    mpesa_code: receipt || order.mpesa_code,
                    transaction_code: receipt || order.mpesa_code,
                    mpesa_receipt: receipt || order.mpesa_code,
                    amount_paid: amountPaid || order.total_amount || 0,
                    confirmed_at: new Date().toISOString(),
                    paid_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    admin_required: false
                };
                
                await supabase
                    .from('orders')
                    .update(updateData)
                    .eq('id', order.id);
                
                console.log(`✅ Order ${order.order_ref} marked as PAID`);
                
                // ─── FULFILL PURCHASE ──────────────────────────────
                await fulfillPurchase(order.id);
                
                return res.status(200).json({
                    success: true,
                    message: 'Payment verified successfully!',
                    order_id: order.id,
                    order_ref: order.order_ref,
                    status: 'paid',
                    isPaid: true,
                    verified: true,
                    mpesa_code: receipt || order.mpesa_code
                });
            } else {
                console.log(`⏳ MegaPay status for ${order.order_ref}: ${statusResult?.status || 'unknown'}`);
            }
        }
        
        // ─── IF M-PESA CODE PROVIDED (MANUAL VERIFICATION) ──────
        // This requires admin approval - NO AUTO-VERIFICATION
        if (mpesa_code) {
            console.log(`📝 Manual verification with M-PESA code: ${mpesa_code} for order ${order.order_ref}`);
            
            // Check if this M-PESA code was already used for another order
            const { data: existingOrder, error: dupError } = await supabase
                .from('orders')
                .select('*')
                .eq('mpesa_code', mpesa_code)
                .neq('id', order.id)
                .maybeSingle();
            
            if (existingOrder) {
                return res.status(400).json({
                    success: false,
                    error: 'This M-PESA transaction has already been used',
                    code: 'DUPLICATE_TRANSACTION'
                });
            }
            
            // ─── MARK FOR ADMIN VERIFICATION ──────────────────────
            // NO AUTO-APPROVAL! Admin must verify manually.
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
                    payment_confirmed: false,  // NOT confirmed!
                    payment_verified: false,   // NOT verified!
                    updated_at: new Date().toISOString()
                })
                .eq('id', order.id);
            
            console.log(`⏳ Order ${order.order_ref} marked for admin verification`);
            
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
        
        // ─── STILL PENDING ──────────────────────────────────────
        console.log(`⏳ Order ${order.order_ref} is still pending`);
        
        return res.status(200).json({
            success: true,
            message: 'Payment is still pending. Please complete the M-PESA transaction on your phone.',
            order_id: order.id,
            order_ref: order.order_ref,
            status: order.status || 'pending',
            isPaid: false,
            verified: false,
            admin_required: order.admin_required || false,
            transaction_request_id: order.transaction_request_id || null
        });
        
    } catch (error) {
        console.error('❌ Verify payment error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── MEGAPAY CALLBACK / WEBHOOK ──────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 MegaPay Callback received!');
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));

    // Always respond quickly to MegaPay
    res.status(200).json({ 
        success: true, 
        message: 'Callback received and acknowledged' 
    });

    try {
        const data = req.body;
        
        let reference = data.TransactionReference || data.reference || data.Reference || 
                       data.order_ref || data.payment_reference || data.CheckoutRequestID || 
                       data.MerchantRequestID || data.TransactionID;
        
        console.log(`🔍 MegaPay sent reference: ${reference}`);
        
        if (!reference) {
            console.warn('⚠️ No reference found in callback');
            return;
        }
        
        let order = null;
        
        // Try all possible reference fields
        const searches = [
            { field: 'payment_reference', value: reference },
            { field: 'provider_reference', value: reference },
            { field: 'order_ref', value: reference },
            { field: 'checkout_request_id', value: reference },
            { field: 'merchant_request_id', value: reference },
            { field: 'transaction_request_id', value: reference },
            { field: 'reference', value: reference }
        ];
        
        for (const search of searches) {
            const { data: orderData, error } = await supabase
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
        
        console.log(`📊 Order found: ${order.order_ref}, current status: ${order.status}, payment_status: ${order.payment_status}`);
        
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            console.log(`🔄 Order ${order.order_ref} already paid. Skipping duplicate.`);
            return;
        }
        
        // ─── CHECK IF MEGAPAY CONFIRMS PAYMENT ──────────────────
        const isPaid = data.ResponseCode === 0 || 
                      data.ResponseCode === '0' ||
                      data.ResponseCode === '00' ||
                      data.ResponseCode === '200' ||
                      data.status === 'success' || 
                      data.success === true ||
                      data.TransactionStatus === 'Completed' ||
                      data.TransactionStatus === 'completed' ||
                      data.ResultCode === '200' ||
                      data.ResultCode === 200;
        
        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'} for order ${order.order_ref}`);
        
        if (isPaid) {
            const transactionId = data.TransactionID || data.TransactionId || data.transaction_id || 'N/A';
            const transactionReceipt = data.TransactionReceipt || data.receipt || data.mpesa_code || 'N/A';
            const amountPaid = data.TransactionAmount || data.Amount || data.amount || order.total_amount || 0;
            
            // ─── UPDATE ORDER AS PAID ──────────────────────────────
            const updateData = {
                status: 'paid',
                payment_status: 'paid',
                payment_confirmed: true,
                payment_verified: true,
                provider_transaction_id: transactionId,
                mpesa_transaction_id: transactionId,
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
            };

            await supabase
                .from('orders')
                .update(updateData)
                .eq('id', order.id);

            logPaymentEvent('ORDER_MARKED_PAID', {
                order_id: order.id,
                order_ref: order.order_ref,
                reference: reference,
                transaction_id: transactionId,
                receipt: transactionReceipt,
                amount: amountPaid
            });

            console.log(`✅ Order ${order.order_ref} marked as PAID by MegaPay callback`);

            // ─── FULFILL PURCHASE ──────────────────────────────
            await fulfillPurchase(order.id);

        } else {
            const failureReason = data.ResponseDescription || data.errorMessage || data.message || 'Payment failed';

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

            console.log(`❌ Order ${order.order_ref} marked as FAILED by MegaPay callback`);
        }

    } catch (error) {
        console.error('❌ Callback processing error:', error);
    }
});

// ─── ADMIN: VERIFY PAYMENT (SECURE ADMIN ENDPOINT) ──────────────
app.post('/api/admin/verify-payment', async (req, res) => {
    console.log('🔐 Admin verification request');
    console.log('📥 Body:', req.body);
    
    try {
        const { order_id, admin_key } = req.body;
        
        // Simple admin key check - in production use proper auth
        const ADMIN_KEY = 'KenyaVault2026Admin';
        
        if (admin_key !== ADMIN_KEY) {
            return res.status(401).json({
                success: false,
                error: 'Unauthorized. Invalid admin key.'
            });
        }
        
        if (!order_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing order_id'
            });
        }
        
        const { data: order, error: findError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', order_id)
            .single();
        
        if (findError || !order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        console.log(`📊 Admin verifying order: ${order.order_ref}, current status: ${order.status}`);
        
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            return res.status(400).json({
                success: false,
                error: 'Order already paid'
            });
        }
        
        // ─── ADMIN APPROVES THE PAYMENT ──────────────────────────
        const updateData = {
            status: 'paid',
            payment_status: 'paid',
            payment_confirmed: true,
            payment_verified: true,
            confirmed_at: new Date().toISOString(),
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            admin_required: false,
            admin_verified_by: 'admin',
            admin_verified_at: new Date().toISOString()
        };
        
        await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order.id);
        
        console.log(`✅ Order ${order.order_ref} marked as PAID by admin`);
        
        // ─── FULFILL PURCHASE ──────────────────────────────
        await fulfillPurchase(order.id);
        
        return res.status(200).json({
            success: true,
            message: 'Payment verified by admin successfully',
            order_id: order.id,
            order_ref: order.order_ref,
            status: 'paid'
        });
        
    } catch (error) {
        console.error('❌ Admin verification error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.header('Access-Control-Allow-Origin', '*');
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
    res.header('Access-Control-Allow-Origin', '*');
    res.status(200).json({
        message: 'KenyaVault Payment Server is running!',
        endpoints: {
            stk_push: 'POST /api/mpesa/stk-push',
            verify_payment: 'POST /api/mpesa/verify-payment',
            admin_verify: 'POST /api/admin/verify-payment',
            health: 'GET /api/health',
            callback: 'POST /api/mpesa/callback'
        }
    });
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: https://kenyavault.onrender.com/api/health`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`✅ Server is ready!`);
    console.log(`🔒 Payment verification requires MegaPay confirmation OR admin approval`);
    console.log(`⏳ Orders stay in 'pending' status until payment is confirmed`);
});

module.exports = app;
