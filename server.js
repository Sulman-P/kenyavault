// ============================================================
// KENYA VAULT - PAYMENT SERVER (COMPLETE ARCHITECTURE - FIXED)
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

// Handle preflight requests explicitly
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
                .select('title')
                .eq('id', resourceId)
                .single();
            
            if (!resourceError && resource) {
                console.log(`✅ Resource "${resource.title}" purchased`);
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

        // Check for various success indicators
        const isPaid = result.TransactionStatus === 'Completed' ||
                      result.TransactionStatus === 'completed' ||
                      result.TransactionCode === '0' ||
                      result.TransactionCode === 0 ||
                      result.ResultCode === '200' ||
                      result.ResultCode === 200 ||
                      result.success === '200' ||
                      result.success === 200 ||
                      result.status === 'success' ||
                      result.status === 'paid' ||
                      result.Status === 'Success' ||
                      result.Status === 'success';

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

// ─── BACKGROUND VERIFICATION ──────────────────────────────────────
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
                console.log(`ℹ️ No transaction_request_id for order ${order.order_ref}, skipping`);
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
            } else {
                console.log(`ℹ️ Order ${order.order_ref} still pending (${statusResult?.status || 'unknown'})`);
            }
        }
        
        console.log(`✅ Background verification complete: ${verified} verified, ${pendingOrders.length - verified} still pending`);
        
    } catch (error) {
        console.error('❌ Background verification error:', error);
    }
}

// ─── RUN BACKGROUND VERIFICATION ──────────────────────────────────
setInterval(verifyPendingOrders, 60000);
setTimeout(verifyPendingOrders, 5000);

// ─── STK PUSH ENDPOINT ──────────────────────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    console.log('📥 Request body:', req.body);
    
    // Set CORS headers for this response
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const { phone, amount, order_id, order_ref, customer_name, customer_email, retry, retry_count } = req.body;

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
            order_id,
            retry: retry || false,
            retry_count: retry_count || 0
        });

        // ─── UPDATE ORDER WITH REFERENCE ──────────────────────────
        const updateData = {
            order_ref: orderRef,
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

        // ─── SEND TO MEGAPAY ──────────────────────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: numericAmount.toString(),
            msisdn: formattedPhone,
            reference: kvReference
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload, null, 2));

        // Add timeout to the fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

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
                console.error('Response text:', responseText);
                return res.status(500).json({
                    success: false,
                    error: 'Invalid response from MegaPay: ' + responseText.substring(0, 200)
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

        console.log('📥 MegaPay Result fields:', Object.keys(megaPayResult));
        console.log('📊 MegaPay Result:', JSON.stringify(megaPayResult, null, 2));

        // ─── CHECK MEGAPAY RESPONSE ──────────────────────────────
        // MegaPay returns success as "200" string or 200 number
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

        console.log(`📊 MegaPay success check: isSuccess=${isSuccess}, successCode=${successCode}`);

        if (isSuccess) {
            // ─── SAVE TRANSACTION REQUEST ID ──────────────────────
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
                                        megaPayResult.checkout_request_id ||
                                        megaPayResult.reference ||
                                        kvReference;
            
            console.log(`✅ Extracted Transaction Request ID: ${transactionRequestId}`);
            
            if (transactionRequestId) {
                const { error: saveError } = await supabase
                    .from('orders')
                    .update({
                        transaction_request_id: transactionRequestId,
                        checkout_request_id: transactionRequestId,
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
                // Use the kvReference as fallback
                await supabase
                    .from('orders')
                    .update({
                        transaction_request_id: kvReference,
                        checkout_request_id: kvReference,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order_id);
                console.log(`✅ Used kvReference as fallback: ${kvReference}`);
            }

            logPaymentEvent('STK_SENT', { 
                reference: kvReference, 
                order_id, 
                orderRef,
                transaction_request_id: transactionRequestId || kvReference,
                megaPayResponse: megaPayResult
            });
            
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    reference: kvReference,
                    order_id: order_id,
                    order_ref: orderRef,
                    status: 'pending',
                    phone: formattedPhone,
                    transaction_request_id: transactionRequestId || kvReference,
                    megaPayResponse: megaPayResult
                }
            });
        } else {
            // ─── EXTRACT ERROR MESSAGE ──────────────────────────────
            const errorMessage = megaPayResult.massage || 
                                megaPayResult.message ||
                                megaPayResult.ResultDesc || 
                                megaPayResult.errorMessage || 
                                megaPayResult.error ||
                                megaPayResult.error_description ||
                                megaPayResult.description ||
                                'Unknown MegaPay error';
            
            console.error('❌ MegaPay error:', errorMessage);
            console.error('❌ Full MegaPay response:', JSON.stringify(megaPayResult, null, 2));
            
            // Don't mark order as failed on network errors - keep it pending for retry
            const shouldMarkFailed = !errorMessage.includes('timeout') && 
                                    !errorMessage.includes('network') &&
                                    !errorMessage.includes('connection') &&
                                    !errorMessage.includes('unavailable');
            
            if (shouldMarkFailed) {
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
            }
            
            return res.status(400).json({
                success: false,
                error: errorMessage,
                code: megaPayResult.ResultCode || megaPayResult.code,
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

// ─── MEGAPAY CALLBACK / WEBHOOK ──────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 MegaPay Callback received!');
    console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));

    // Always respond to MegaPay quickly
    res.status(200).json({ 
        success: true, 
        message: 'Callback received and acknowledged' 
    });

    try {
        const data = req.body;
        
        let reference = data.TransactionReference || data.reference || data.Reference || data.order_ref || data.payment_reference || data.CheckoutRequestID || data.MerchantRequestID;
        
        console.log(`🔍 MegaPay sent reference: ${reference}`);
        
        if (!reference) {
            console.warn('⚠️ No reference found in callback');
            return;
        }
        
        let order = null;
        let searchMethod = 'none';
        
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
                searchMethod = search.field;
                console.log(`✅ Found order by ${search.field}: ${order.order_ref}`);
                break;
            }
        }
        
        if (!order) {
            console.log(`❌ Order NOT found for reference: ${reference}`);
            return;
        }
        
        console.log(`📊 Found order: ${order.order_ref} (${searchMethod})`);
        
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            console.log(`🔄 Order ${order.order_ref} already paid. Skipping duplicate.`);
            return;
        }
        
        const isPaid = data.ResponseCode === 0 || 
                      data.ResponseCode === '0' ||
                      data.ResponseCode === '00' ||
                      data.ResponseCode === '200' ||
                      data.status === 'success' || 
                      data.success === true ||
                      data.success === '200' ||
                      data.success === 200 ||
                      data.ResponseDescription === 'Success' ||
                      data.ResponseDescription === 'Success. Request accepted for processing' ||
                      data.Status === 'Completed' ||
                      data.status === 'completed' ||
                      data.TransactionStatus === 'Completed' ||
                      data.TransactionStatus === 'completed' ||
                      data.ResultCode === '200' ||
                      data.ResultCode === 200;
        
        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        console.log(`📝 ResponseCode: ${data.ResponseCode}, ResponseDescription: ${data.ResponseDescription}`);
        
        if (isPaid) {
            const transactionId = data.TransactionID || data.TransactionId || data.transaction_id || 'N/A';
            const transactionReceipt = data.TransactionReceipt || data.receipt || data.mpesa_code || 'N/A';
            const amountPaid = data.TransactionAmount || data.Amount || data.amount || order.total_amount || 0;
            
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
                webhook_processed: true
            };

            if (reference && !order.provider_reference) {
                updateData.provider_reference = reference;
            }

            const { error: updateError } = await supabase
                .from('orders')
                .update(updateData)
                .eq('id', order.id);

            if (updateError) {
                console.error('❌ Failed to update order:', updateError);
                return;
            }

            logPaymentEvent('ORDER_MARKED_PAID', {
                order_id: order.id,
                order_ref: order.order_ref,
                reference: reference,
                transaction_id: transactionId,
                receipt: transactionReceipt,
                amount: amountPaid
            });

            console.log(`✅ Order ${order.order_ref} marked as PAID`);

            try {
                await fulfillPurchase(order.id);
            } catch (fulfillError) {
                console.error('❌ Fulfillment error:', fulfillError);
            }

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

            logPaymentEvent('ORDER_MARKED_FAILED', {
                order_id: order.id,
                order_ref: order.order_ref,
                reference: reference,
                reason: failureReason
            });

            console.log(`❌ Order ${order.order_ref} marked as FAILED`);
        }

    } catch (error) {
        console.error('❌ Callback processing error:', error);
    }
});

// ─── VERIFY PAYMENT STATUS ──────────────────────────────────────────
app.get('/api/mpesa/verify/:reference', async (req, res) => {
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const { reference } = req.params;
        console.log(`🔍 Verifying payment: ${reference}`);

        let order = null;
        
        const { data: orderByRef, error: refError } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .maybeSingle();
        
        if (orderByRef) {
            order = orderByRef;
        } else {
            const { data: orderByProvider, error: providerError } = await supabase
                .from('orders')
                .select('*')
                .eq('provider_reference', reference)
                .maybeSingle();
            
            if (orderByProvider) {
                order = orderByProvider;
            }
        }

        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        const isPaid = order.payment_status === 'paid' || 
                      order.payment_confirmed === true ||
                      order.payment_verified === true;

        return res.status(200).json({
            success: true,
            data: {
                status: order.status,
                payment_status: order.payment_status,
                payment_confirmed: order.payment_confirmed,
                payment_verified: order.payment_verified,
                payment_reference: order.payment_reference,
                provider_reference: order.provider_reference,
                isPaid: isPaid,
                order_ref: order.order_ref,
                mpesa_code: order.mpesa_code,
                admin_required: order.admin_required || false,
                transaction_request_id: order.transaction_request_id
            }
        });

    } catch (error) {
        console.error('❌ Verification error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── CHECK ORDER STATUS ──────────────────────────────────────────
app.get('/api/mpesa/status/:orderId', async (req, res) => {
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    
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
                payment_status: order.payment_status,
                payment_confirmed: order.payment_confirmed,
                payment_verified: order.payment_verified,
                payment_reference: order.payment_reference,
                provider_reference: order.provider_reference,
                isPaid: isPaid,
                order_ref: order.order_ref,
                mpesa_code: order.mpesa_code,
                transaction_request_id: order.transaction_request_id,
                admin_required: order.admin_required || false
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

// ─── MANUAL PAYMENT VERIFICATION ──────────────────────────────
app.post('/api/mpesa/manual-verify', async (req, res) => {
    console.log('📝 Manual verification request received!');
    console.log('📥 Body:', req.body);
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    try {
        const { order_ref, mpesa_code, phone } = req.body;
        
        if (!order_ref || !mpesa_code) {
            return res.status(400).json({
                success: false,
                error: 'Missing order_ref or mpesa_code'
            });
        }
        
        // ─── FIND THE ORDER ──────────────────────────────────────
        const { data: order, error: findError } = await supabase
            .from('orders')
            .select('*')
            .eq('order_ref', order_ref)
            .single();
        
        if (findError || !order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        // ─── CHECK IF ALREADY PAID ──────────────────────────────
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            return res.status(200).json({
                success: true,
                message: 'Order already paid',
                order_id: order.id,
                status: 'paid'
            });
        }
        
        // ─── CHECK FOR DUPLICATE TRANSACTION ────────────────────
        const { data: existingOrder, error: duplicateError } = await supabase
            .from('orders')
            .select('*')
            .eq('mpesa_code', mpesa_code)
            .neq('id', order.id)
            .maybeSingle();
        
        if (existingOrder) {
            logPaymentEvent('DUPLICATE_TRANSACTION_ATTEMPTED', {
                order_id: order.id,
                order_ref: order.order_ref,
                mpesa_code: mpesa_code,
                existing_order: existingOrder.order_ref
            });
            
            return res.status(400).json({
                success: false,
                error: 'This M-PESA transaction has already been used',
                code: 'DUPLICATE_TRANSACTION'
            });
        }
        
        // ─── UPDATE ORDER ──────────────────────────────────────────
        const updateData = {
            status: 'verifying',
            payment_status: 'verifying',
            mpesa_code: mpesa_code,
            transaction_code: mpesa_code,
            mpesa_receipt: mpesa_code,
            verification_method: 'manual_submission',
            verification_phone: phone || order.phone,
            verification_submitted_at: new Date().toISOString(),
            admin_required: true,
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
        
        logPaymentEvent('MANUAL_PAYMENT_SUBMITTED', {
            order_id: order.id,
            order_ref: order.order_ref,
            mpesa_code: mpesa_code,
            status: 'verifying',
            admin_required: true
        });
        
        console.log(`⏳ Order ${order.order_ref} submitted for admin verification`);
        
        return res.status(200).json({
            success: true,
            message: 'Payment submitted for verification. You will be notified once confirmed.',
            order_id: order.id,
            order_ref: order.order_ref,
            status: 'verifying',
            admin_required: true
        });
        
    } catch (error) {
        console.error('❌ Manual verification error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── ADMIN VERIFY PAYMENT ──────────────────────────────────────────
app.post('/api/admin/verify-payment', async (req, res) => {
    console.log('🔐 Admin payment verification request');
    console.log('📥 Body:', req.body);
    
    try {
        const { order_id, action, admin_id, notes } = req.body;
        
        if (!order_id || !action) {
            return res.status(400).json({
                success: false,
                error: 'Missing order_id or action'
            });
        }
        
        if (!['verify', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid action. Must be "verify" or "reject"'
            });
        }
        
        // ─── FIND THE ORDER ──────────────────────────────────────
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
        
        // ─── CHECK CURRENT STATUS ──────────────────────────────
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            return res.status(400).json({
                success: false,
                error: 'Order already paid'
            });
        }
        
        if (order.status !== 'verifying' && order.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: 'Order is not in a verifiable state'
            });
        }
        
        // ─── PROCESS ACTION ──────────────────────────────────────
        if (action === 'verify') {
            const updateData = {
                status: 'paid',
                payment_status: 'paid',
                payment_confirmed: true,
                payment_verified: true,
                confirmed_at: new Date().toISOString(),
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                admin_verified_by: admin_id || 'admin',
                admin_verified_at: new Date().toISOString(),
                admin_notes: notes || null,
                admin_required: false
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
            
            logPaymentEvent('ADMIN_VERIFIED_PAYMENT', {
                order_id: order.id,
                order_ref: order.order_ref,
                admin_id: admin_id || 'admin',
                mpesa_code: order.mpesa_code
            });
            
            // ─── FULFILL PURCHASE ──────────────────────────────
            await fulfillPurchase(order.id);
            
            console.log(`✅ Order ${order.order_ref} admin verified and fulfilled`);
            
            return res.status(200).json({
                success: true,
                message: 'Payment verified successfully',
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'paid'
            });
            
        } else if (action === 'reject') {
            const updateData = {
                status: 'rejected',
                payment_status: 'rejected',
                admin_verified_by: admin_id || 'admin',
                admin_verified_at: new Date().toISOString(),
                admin_notes: notes || 'Payment verification failed',
                rejection_reason: notes || 'Payment verification failed',
                updated_at: new Date().toISOString(),
                admin_required: false
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
            
            logPaymentEvent('ADMIN_REJECTED_PAYMENT', {
                order_id: order.id,
                order_ref: order.order_ref,
                admin_id: admin_id || 'admin',
                reason: notes || 'Payment verification failed'
            });
            
            console.log(`❌ Order ${order.order_ref} rejected by admin`);
            
            return res.status(200).json({
                success: true,
                message: 'Payment rejected',
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'rejected'
            });
        }
        
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
            callback_url: MEGAPAY_CALLBACK_URL,
            background_verification: 'running (every 60s)'
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
            health: 'GET /api/health',
            callback: 'POST /api/mpesa/callback',
            status: 'GET /api/mpesa/status/:orderId',
            verify: 'GET /api/mpesa/verify/:reference',
            manual_verify: 'POST /api/mpesa/manual-verify',
            admin_verify: 'POST /api/admin/verify-payment'
        },
        background_verification: {
            status: 'running',
            interval: '60 seconds'
        }
    });
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: https://kenyavault.onrender.com/api/health`);
    console.log(`📞 MegaPay API: ${MEGAPAY_INITIATE_URL}`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`✅ Server is ready!`);
    console.log(`🔍 Background verification running every 60 seconds`);
});

module.exports = app;