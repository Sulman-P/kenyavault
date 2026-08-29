// ============================================================
// KENYA VAULT - PAYMENT SERVER (FIXED)
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
        'http://127.0.0.1:5500',
        'http://127.0.0.1:3000',
        'https://kenyavault.onrender.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    credentials: true
}));

app.options('*', cors());
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

// ─── CHECK MEGAPAY TRANSACTION STATUS ──────────────────────────────
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

        // Check multiple success indicators
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
                      result.ResponseCode === 0;

        // Get amount from response
        let amount = result.TransactionAmount || result.Amount || result.amount || 0;
        if (typeof amount === 'string') {
            amount = parseFloat(amount) || 0;
        }

        // Get receipt
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

// ─── VERIFY PAYMENT ENDPOINT ──────────────────────────────────────
// This is the endpoint the frontend calls
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
        
        // ─── FIND THE ORDER ──────────────────────────────────────
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
        
        // ─── CHECK IF ALREADY PAID ──────────────────────────────
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
        
        // ─── IF M-PESA CODE PROVIDED, CHECK IT ──────────────────
        if (mpesa_code) {
            console.log(`🔍 Verifying with M-PESA code: ${mpesa_code}`);
            
            // Check if code was already used
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
            
            // Try to verify with MegaPay status API if we have transaction_request_id
            if (order.transaction_request_id) {
                const megaPayStatus = await checkMegaPayStatus(order.transaction_request_id);
                
                if (megaPayStatus && megaPayStatus.isPaid) {
                    console.log(`✅ MegaPay status API confirmed payment for order ${order.order_ref}`);
                    
                    // Update order as paid
                    const updateData = {
                        status: 'paid',
                        payment_status: 'paid',
                        payment_confirmed: true,
                        payment_verified: true,
                        mpesa_code: megaPayStatus.receipt || mpesa_code,
                        transaction_code: megaPayStatus.receipt || mpesa_code,
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
                        return res.status(200).json({
                            isPaid: true,
                            order_id: order.id,
                            order_ref: order.order_ref,
                            status: 'paid',
                            mpesa_code: megaPayStatus.receipt || mpesa_code
                        });
                    }
                }
            }
            
            // If not auto-verified, mark for admin verification
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
        
        // ─── CHECK WITH MEGAPAY STATUS API ──────────────────────
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
                    return res.status(200).json({
                        isPaid: true,
                        order_id: order.id,
                        order_ref: order.order_ref,
                        status: 'paid',
                        mpesa_code: megaPayStatus.receipt || ''
                    });
                }
            } else if (megaPayStatus) {
                console.log(`⏳ MegaPay status: ${megaPayStatus.status || 'unknown'}, isPaid: ${megaPayStatus.isPaid}`);
                
                return res.status(200).json({
                    isPaid: false,
                    status: megaPayStatus.status || 'pending',
                    order_id: order.id,
                    order_ref: order.order_ref,
                    message: 'Payment is still being processed'
                });
            }
        }
        
        // ─── CHECK ORDER STATUS FROM SUPABASE ───────────────────
        if (order.payment_status === 'pending' || order.status === 'pending') {
            return res.status(200).json({
                isPaid: false,
                status: 'pending',
                order_id: order.id,
                order_ref: order.order_ref,
                message: 'Payment is still pending'
            });
        }
        
        if (order.status === 'failed' || order.payment_status === 'failed') {
            return res.status(200).json({
                isPaid: false,
                status: 'failed',
                order_id: order.id,
                order_ref: order.order_ref,
                message: 'Payment failed'
            });
        }
        
        // Default response
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

// ─── STK PUSH ENDPOINT ──────────────────────────────────────────────
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
        const orderRef = order_ref || generateOrderRef();

        logPaymentEvent('STK_INITIATED', { 
            phone: formattedPhone, 
            amount: numericAmount, 
            kvReference,
            orderRef,
            order_id
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
            reference: kvReference,
            callback_url: MEGAPAY_CALLBACK_URL
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload, null, 2));

        const megaPayResponse = await fetch(MEGAPAY_INITIATE_URL, {
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
        } catch (parseError) {
            console.error('❌ Failed to parse MegaPay response:', parseError);
            return res.status(500).json({
                success: false,
                error: 'Invalid response from MegaPay'
            });
        }

        console.log('📥 MegaPay Result:', JSON.stringify(megaPayResult, null, 2));

        // ─── CHECK MEGAPAY RESPONSE ──────────────────────────────
        const isSuccess = megaPayResult.success === '200' || 
                         megaPayResult.success === 200 ||
                         megaPayResult.ResultCode === '0' ||
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.ResponseCode === '0' ||
                         megaPayResult.ResponseCode === 0;

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
                                        megaPayResult.checkout_request_id;
            
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
            }

            logPaymentEvent('STK_SENT', { 
                reference: kvReference, 
                order_id, 
                orderRef,
                transaction_request_id: transactionRequestId 
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
                    transaction_request_id: transactionRequestId,
                    megaPayResponse: megaPayResult
                }
            });
        } else {
            const errorMessage = megaPayResult.massage || 
                                megaPayResult.ResultDesc || 
                                megaPayResult.errorMessage || 
                                megaPayResult.ResponseDescription ||
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

// ─── MEGAPAY CALLBACK / WEBHOOK ──────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 MegaPay Callback received!');
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));

    try {
        const data = req.body;
        
        let reference = data.TransactionReference || data.reference || data.Reference || data.order_ref || data.payment_reference || data.CheckoutRequestID;
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
        
        // ─── FIND THE ORDER ──────────────────────────────────────
        let order = null;
        let searchMethod = 'none';
        
        // Try payment_reference
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
        
        // Try provider_reference
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
        
        // Try order_ref
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
        
        // Try CheckoutRequestID
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
        
        if (!order) {
            console.log(`❌ Order NOT found for reference: ${reference}`);
            return res.status(200).json({ 
                success: true, 
                message: 'Order not found but acknowledged',
                reference: reference
            });
        }
        
        console.log(`📊 Found order: ${order.order_ref} (${searchMethod})`);
        
        // ─── CHECK IF ALREADY PAID ──────────────────────────────
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            console.log(`🔄 Order ${order.order_ref} already paid. Skipping duplicate.`);
            return res.status(200).json({
                success: true,
                message: 'Order already processed',
                order_id: order.id,
                status: 'duplicate'
            });
        }
        
        // ─── CHECK IF PAYMENT WAS SUCCESSFUL ────────────────────
        const isPaid = data.ResponseCode === 0 || 
                      data.ResponseCode === '0' ||
                      data.ResponseCode === '00' ||
                      data.ResultCode === '0' ||
                      data.ResultCode === 0 ||
                      data.status === 'success' || 
                      data.success === true ||
                      data.success === '200' ||
                      data.ResponseDescription === 'Success' ||
                      data.ResponseDescription === 'Success. Request accepted for processing' ||
                      data.TransactionStatus === 'Completed' ||
                      data.TransactionStatus === 'completed';
        
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
                checkout_request_id: data.CheckoutRequestID || order.checkout_request_id,
                merchant_request_id: data.MerchantRequestID || order.merchant_request_id,
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
                transaction_receipt: finalReceipt
            });

        } else {
            const failureReason = data.ResponseDescription || data.errorMessage || data.ResultDesc || 'Payment failed';

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
            
            // Update download count
            const { data: resource, error: resourceError } = await supabase
                .from('resources')
                .select('download_count')
                .eq('id', resourceId)
                .single();
            
            if (!resourceError && resource) {
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
    } catch (error) {
        console.error('❌ Fulfillment error:', error);
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

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
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
    res.status(200).json({
        message: 'KenyaVault Payment Server is running!',
        endpoints: {
            stk_push: 'POST /api/mpesa/stk-push',
            health: 'GET /api/health',
            callback: 'POST /api/mpesa/callback',
            verify_payment: 'POST /api/mpesa/verify-payment',
            manual_verify: 'POST /api/mpesa/manual-verify'
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
