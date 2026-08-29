// ============================================================
// KENYA VAULT - PAYMENT SERVER (COMPLETE WORKING)
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
        'https://kenyavault.onrender.com'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
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
        console.log('📥 MegaPay Status Response:', responseText);

        let result;
        try {
            result = JSON.parse(responseText);
        } catch (e) {
            console.error('❌ Failed to parse MegaPay status response:', e);
            return null;
        }

        // ─── CHECK IF TRANSACTION IS COMPLETED ──────────────────
        const isPaid = result.TransactionStatus === 'Completed' ||
                      result.TransactionStatus === 'completed' ||
                      result.TransactionCode === '0' ||
                      result.TransactionCode === 0 ||
                      result.ResultCode === '200' ||
                      result.ResultCode === 200;

        return {
            isPaid: isPaid,
            transactionId: result.TransactionID,
            receipt: result.TransactionReceipt,
            amount: result.TransactionAmount,
            status: result.TransactionStatus,
            resultCode: result.ResultCode,
            resultDesc: result.ResultDesc,
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
        // Get pending orders older than 2 minutes
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
            // Try multiple fields for transaction ID
            const transactionRequestId = order.transaction_request_id || 
                                        order.checkout_request_id || 
                                        order.mpesa_transaction_id;
            
            if (!transactionRequestId) {
                console.log(`ℹ️ No transaction_request_id for order ${order.order_ref}, skipping`);
                continue;
            }
            
            console.log(`🔍 Verifying order ${order.order_ref} with transaction_request_id: ${transactionRequestId}`);
            
            // Check if already has M-PESA code (manual verification)
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
            
            // Check status with MegaPay API
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
                         megaPayResult.ResultCode === 0;

        if (isSuccess) {
            // ─── SAVE TRANSACTION REQUEST ID ──────────────────────
            const transactionRequestId = megaPayResult.transaction_request_id || 
                                        megaPayResult.TransactionID || 
                                        megaPayResult.CheckoutRequestID;
            
            console.log(`✅ Transaction Request ID: ${transactionRequestId}`);
            
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
                    transaction_request_id: transactionRequestId
                }
            });
        } else {
            const errorMessage = megaPayResult.massage || 
                                megaPayResult.ResultDesc || 
                                megaPayResult.errorMessage || 
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

// ─── MEGAPAY CALLBACK / WEBHOOK ──────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 MegaPay Callback received!');
    console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));

    try {
        const data = req.body;
        
        // ─── EXTRACT REFERENCE ──────────────────────────────────
        let reference = data.TransactionReference || data.reference || data.Reference || data.order_ref || data.payment_reference || data.CheckoutRequestID;
        
        console.log(`🔍 MegaPay sent reference: ${reference}`);
        
        if (!reference) {
            console.warn('⚠️ No reference found in callback');
            return res.status(200).json({ 
                success: true, 
                message: 'No reference found - acknowledged' 
            });
        }
        
        // ─── SEARCH FOR ORDER ──────────────────────────────────
        let order = null;
        let searchMethod = 'none';
        
        // 1. Try payment_reference
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
        
        // 2. Try provider_reference
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
        
        // 3. Try order_ref
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
        
        // 4. Try CheckoutRequestID
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
        
        // 5. Try MerchantRequestID
        if (!order && data.MerchantRequestID) {
            const { data: orderByMerchant, error: error5 } = await supabase
                .from('orders')
                .select('*')
                .eq('merchant_request_id', data.MerchantRequestID)
                .maybeSingle();
            
            if (orderByMerchant) {
                order = orderByMerchant;
                searchMethod = 'merchant_request_id';
                console.log(`✅ Found order by merchant_request_id: ${order.order_ref}`);
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
        
        // ─── CHECK IF ALREADY PROCESSED ──────────────────────────
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            console.log(`🔄 Order ${order.order_ref} already paid. Skipping duplicate.`);
            return res.status(200).json({
                success: true,
                message: 'Order already processed',
                order_id: order.id,
                status: 'duplicate'
            });
        }
        
        // ─── DETERMINE PAYMENT STATUS ──────────────────────────────
        const isPaid = data.ResponseCode === 0 || 
                      data.ResponseCode === '0' ||
                      data.ResponseCode === '00' ||
                      data.status === 'success' || 
                      data.success === true ||
                      data.ResponseDescription === 'Success' ||
                      data.ResponseDescription === 'Success. Request accepted for processing';
        
        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        console.log(`📝 ResponseCode: ${data.ResponseCode}, ResponseDescription: ${data.ResponseDescription}`);
        
        if (isPaid) {
            const transactionId = data.TransactionID || 'N/A';
            const transactionReceipt = data.TransactionReceipt || 'N/A';
            const amountPaid = data.TransactionAmount || data.Amount || data.amount || order.total_amount || 0;
            
            // ─── UPDATE ORDER TO PAID ──────────────────────────────
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
                checkout_request_id: data.CheckoutRequestID,
                merchant_request_id: data.MerchantRequestID
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
                return res.status(200).json({
                    success: false,
                    error: 'Failed to update order'
                });
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

            return res.status(200).json({
                success: true,
                message: 'Payment processed successfully',
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'paid',
                transaction_receipt: transactionReceipt
            });

        } else {
            const failureReason = data.ResponseDescription || data.errorMessage || 'Payment failed';

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

// ─── MANUAL VERIFICATION ENDPOINT ──────────────────────────────────
app.post('/api/mpesa/manual-verify', async (req, res) => {
    console.log('📝 Manual verification request received!');
    console.log('📥 Body:', req.body);
    
    try {
        const { order_ref, mpesa_code, phone } = req.body;
        
        if (!order_ref || !mpesa_code) {
            return res.status(400).json({
                success: false,
                error: 'Missing order_ref or mpesa_code'
            });
        }
        
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
        
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            return res.status(200).json({
                success: true,
                message: 'Order already paid',
                order_id: order.id,
                status: 'paid'
            });
        }
        
        await supabase
            .from('orders')
            .update({
                status: 'paid',
                payment_status: 'paid',
                payment_confirmed: true,
                payment_verified: true,
                mpesa_code: mpesa_code,
                transaction_code: mpesa_code,
                mpesa_receipt: mpesa_code,
                amount_paid: order.total_amount || 0,
                confirmed_at: new Date().toISOString(),
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', order.id);
        
        await fulfillPurchase(order.id);
        
        console.log(`✅ Order ${order_ref} manually verified with M-PESA: ${mpesa_code}`);
        
        return res.status(200).json({
            success: true,
            message: 'Payment verified successfully',
            order_id: order.id,
            order_ref: order.order_ref,
            status: 'paid'
        });
        
    } catch (error) {
        console.error('❌ Manual verification error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── VERIFY PAYMENT ──────────────────────────────────────────────
app.get('/api/mpesa/verify/:reference', async (req, res) => {
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
                mpesa_code: order.mpesa_code
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
                transaction_request_id: order.transaction_request_id
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
            status: 'GET /api/mpesa/status/:orderId',
            verify: 'GET /api/mpesa/verify/:reference',
            manual_verify: 'POST /api/mpesa/manual-verify',
            fix_orders: 'POST /api/mpesa/fix-orders'
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
