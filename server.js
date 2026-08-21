// ============================================================
// KENYA VAULT - PAYMENT SERVER (COMPLETE WITH MEGAPAY FIXES)
// ============================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
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
const MEGAPAY_API_URL = 'https://megapay.co.ke/backend/v1/initiatestk';
const MEGAPAY_STATUS_URL = 'https://megapay.co.ke/backend/v1/transaction/status';
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
        
        // Parse cart items
        let items = order.cart_items;
        if (typeof items === 'string') {
            try { items = JSON.parse(items); } catch (e) { items = []; }
        }
        
        if (!items || items.length === 0) {
            console.log(`ℹ️ No items in order ${orderId}`);
            return;
        }
        
        // Log purchased resources
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
        
        // Update order fulfillment status
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
        throw error;
    }
}

// ─── CHECK MEGAPAY TRANSACTION STATUS ──────────────────────────────
async function checkMegaPayStatus(reference) {
    try {
        console.log(`🔍 Checking MegaPay status for: ${reference}`);
        
        const response = await fetch(MEGAPAY_STATUS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                api_key: MEGAPAY_API_KEY,
                reference: reference
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

        // ─── CHECK USING MEGAPAY'S ACTUAL FIELDS ──────────────
        const isPaid = result.ResponseCode === 0 || 
                      result.ResponseCode === '0' ||
                      result.ResponseCode === '00' ||
                      result.status === 'success' || 
                      result.success === true ||
                      result.ResultCode === '0' ||
                      result.ResultCode === 0;

        return {
            isPaid: isPaid,
            transactionId: result.TransactionID || result.transaction_id || result.TransactionId,
            receipt: result.TransactionReceipt || result.mpesa_receipt,
            amount: result.TransactionAmount || result.Amount || result.amount,
            status: result.ResponseDescription || result.ResultDesc || result.status,
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
        // Get pending orders older than 2 minutes (to give time for callback)
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
        let failed = 0;
        
        for (const order of pendingOrders) {
            // Get the reference (try multiple fields)
            const reference = order.payment_reference || order.provider_reference || order.transaction_reference;
            if (!reference) {
                console.log(`ℹ️ No reference for order ${order.order_ref}, skipping`);
                continue;
            }
            
            console.log(`🔍 Verifying order ${order.order_ref} with reference: ${reference}`);
            
            // Check if order already has M-PESA code (manual verification)
            if (order.mpesa_code && order.mpesa_code.length > 0) {
                console.log(`✅ Order ${order.order_ref} already has M-PESA code: ${order.mpesa_code}`);
                
                // If it has M-PESA code but still pending, mark as paid
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
            const statusResult = await checkMegaPayStatus(reference);
            
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
                
                // Fulfill purchase
                await fulfillPurchase(order.id);
                verified++;
            } else {
                console.log(`ℹ️ Order ${order.order_ref} still pending (not verified)`);
                failed++;
            }
        }
        
        console.log(`✅ Background verification complete: ${verified} verified, ${failed} still pending`);
        
    } catch (error) {
        console.error('❌ Background verification error:', error);
    }
}

// ─── RUN BACKGROUND VERIFICATION ──────────────────────────────────
// Run every 60 seconds
setInterval(verifyPendingOrders, 60000);

// Run on startup (after 5 seconds)
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
            amount: numericAmount,
            msisdn: formattedPhone,
            reference: kvReference,
            callback_url: MEGAPAY_CALLBACK_URL,
            order_ref: orderRef,
            order_id: order_id,
            customer_name: customer_name || 'Customer',
            customer_email: customer_email || 'customer@kenyavault.co.ke'
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload, null, 2));

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
        } catch (parseError) {
            console.error('❌ Failed to parse MegaPay response:', parseError);
            return res.status(500).json({
                success: false,
                error: 'Invalid response from MegaPay'
            });
        }

        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.ResultCode === '00' ||
                         megaPayResult.status === 'success' || 
                         megaPayResult.success === true ||
                         megaPayResult.ResultCode === 'SUCCESS';

        if (isSuccess) {
            logPaymentEvent('STK_SENT', { reference: kvReference, order_id, orderRef });
            
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    reference: kvReference,
                    order_id: order_id,
                    order_ref: orderRef,
                    status: 'pending',
                    phone: formattedPhone
                }
            });
        } else {
            const errorMessage = megaPayResult.ResultDesc || 
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

// ─── MEGAPAY CALLBACK / WEBHOOK (UPDATED WITH CORRECT PAYLOAD) ──
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 MegaPay Callback received!');
    console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));

    try {
        const data = req.body;
        
        // ─── EXTRACT REFERENCE - USING CORRECT MEGAPAY FIELDS ──
        // MegaPay uses 'TransactionReference' for the custom reference
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
        
        // 1. Try payment_reference (our reference)
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
                reference: reference,
                debug: {
                    ResponseCode: data.ResponseCode,
                    TransactionReference: data.TransactionReference,
                    CheckoutRequestID: data.CheckoutRequestID
                }
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
        // MegaPay uses ResponseCode: 0 = success
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
            const transactionId = data.TransactionID || data.TransactionID || 'N/A';
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

            // Only add provider_reference if it's different
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
                amount: amountPaid,
                checkout_request_id: data.CheckoutRequestID
            });

            console.log(`✅ Order ${order.order_ref} marked as PAID`);

            // ─── FULFILL PURCHASE ──────────────────────────────
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
            // ─── PAYMENT FAILED ──────────────────────────────────
            const failureReason = data.ResponseDescription || data.errorMessage || 'Payment failed';

            await supabase
                .from('orders')
                .update({
                    status: 'failed',
                    payment_status: 'failed',
                    failure_reason: failureReason,
                    payment_error: failureReason,
                    updated_at: new Date().toISOString(),
                    callback_received_at: new Date().toISOString(),
                    checkout_request_id: data.CheckoutRequestID,
                    merchant_request_id: data.MerchantRequestID
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
        
        // Find the order
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
        
        // Check if already paid
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            return res.status(200).json({
                success: true,
                message: 'Order already paid',
                order_id: order.id,
                status: 'paid'
            });
        }
        
        // Update order
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
        
        // Fulfill purchase
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
                mpesa_code: order.mpesa_code
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

// ─── FIX EXISTING ORDERS ──────────────────────────────────────────
app.post('/api/mpesa/fix-orders', async (req, res) => {
    console.log('🔧 Fixing existing orders...');
    
    try {
        // Get all pending orders with payment_reference but no provider_reference
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('status', 'pending')
            .not('payment_reference', 'is', null);
        
        if (error) {
            console.error('❌ Error fetching orders:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
        
        console.log(`📋 Found ${orders.length} pending orders with payment_reference`);
        
        let updated = 0;
        for (const order of orders) {
            if (order.payment_reference && !order.provider_reference) {
                await supabase
                    .from('orders')
                    .update({
                        provider_reference: order.payment_reference,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order.id);
                updated++;
                console.log(`✅ Updated order ${order.order_ref}: provider_reference = ${order.payment_reference}`);
            }
        }
        
        return res.status(200).json({
            success: true,
            message: `Updated ${updated} orders`,
            updated: updated,
            total: orders.length
        });
        
    } catch (error) {
        console.error('❌ Fix orders error:', error);
        return res.status(500).json({
            success: false,
            error: error.message
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
    console.log(`📞 MegaPay API: ${MEGAPAY_API_URL}`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`✅ Server is ready!`);
    console.log(`🔍 Background verification running every 60 seconds`);
});

module.exports = app;
