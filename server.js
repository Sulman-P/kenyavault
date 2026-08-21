// ============================================================
// KENYA VAULT - PAYMENT SERVER WITH MEGAPAY (FIXED)
// ============================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc0OTM5OSwiZXhwIjoyMDk3MzI1Mzk5fQ.X2Rz5vLgv0Z-sPR7WqWj_yXItwxrX_JLtJAb4S2r8jE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
const MEGAPAY_CALLBACK_URL = 'https://kenyavault.onrender.com/api/mpesa/callback';

// ─── HELPERS ──────────────────────────────────────────────────
function generateTransactionReference() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `KV-${timestamp}-${random}`;
}

function validatePhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.startsWith('0') && cleaned.length === 10) {
        return cleaned;
    }
    
    if (cleaned.startsWith('254') && cleaned.length === 12) {
        return '0' + cleaned.substring(3);
    }
    
    if (phone && phone.startsWith('+254')) {
        return '0' + phone.substring(4).replace(/\D/g, '');
    }
    
    return null;
}

function logPaymentEvent(event, data) {
    console.log(`[PAYMENT] ${event}:`, JSON.stringify(data, null, 2));
}

// ─── STK PUSH ENDPOINT ──────────────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    console.log('📥 Request body:', req.body);
    
    try {
        const { phone, amount, order_id, order_ref, customer_name, customer_email, resource_ids } = req.body;

        // Validate required fields
        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required'
            });
        }

        if (!amount) {
            return res.status(400).json({
                success: false,
                error: 'Amount is required'
            });
        }

        if (!order_id) {
            return res.status(400).json({
                success: false,
                error: 'Order ID is required'
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

        const reference = generateTransactionReference();
        const orderRef = order_ref || 'ORD-' + Date.now().toString().slice(-8);

        logPaymentEvent('STK_INITIATED', { 
            phone: formattedPhone, 
            amount: numericAmount, 
            reference,
            order_id,
            orderRef
        });

        // ─── SAVE REFERENCE TO ORDER ──────────────────────────
        try {
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    payment_reference: reference,
                    transaction_reference: reference,
                    provider_reference: reference,
                    payment_status: 'pending',
                    updated_at: new Date().toISOString()
                })
                .eq('id', order_id);

            if (updateError) {
                console.warn('⚠️ Error updating order (non-critical):', updateError);
            }
        } catch (updateError) {
            console.warn('⚠️ Update error (non-critical):', updateError);
        }

        // ─── MEGAPAY PAYLOAD ────────────────────────────────────
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: numericAmount,
            msisdn: formattedPhone,
            reference: reference,
            callback_url: MEGAPAY_CALLBACK_URL,
            order_ref: orderRef,
            order_id: order_id,
            customer_name: customer_name || 'Customer',
            customer_email: customer_email || 'customer@kenyavault.co.ke'
        };

        console.log('📤 MegaPay Payload:', JSON.stringify(megaPayPayload, null, 2));

        // ─── CALL MEGAPAY API ──────────────────────────────────
        let megaPayResponse;
        try {
            megaPayResponse = await fetch(MEGAPAY_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(megaPayPayload)
            });
        } catch (fetchError) {
            console.error('❌ Fetch error:', fetchError);
            logPaymentEvent('STK_FETCH_ERROR', { error: fetchError.message });
            return res.status(500).json({
                success: false,
                error: 'Failed to connect to MegaPay: ' + fetchError.message
            });
        }

        const responseText = await megaPayResponse.text();
        console.log('📥 MegaPay Raw Response:', responseText);
        
        // ─── PARSE MEGAPAY RESPONSE ────────────────────────────
        let megaPayResult;
        try {
            megaPayResult = JSON.parse(responseText);
        } catch (parseError) {
            console.error('❌ Failed to parse MegaPay response:', parseError);
            console.error('Raw response:', responseText);
            
            if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
                return res.status(500).json({
                    success: false,
                    error: 'MegaPay returned an error page. Please check your configuration.'
                });
            }
            
            return res.status(500).json({
                success: false,
                error: 'Invalid response from MegaPay: ' + responseText.substring(0, 200)
            });
        }

        // ─── CHECK MEGAPAY RESPONSE ────────────────────────────
        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.ResultCode === '00' ||
                         megaPayResult.status === 'success' || 
                         megaPayResult.success === true ||
                         megaPayResult.ResultCode === 'SUCCESS';

        if (isSuccess) {
            logPaymentEvent('STK_SENT', { reference, order_id, orderRef });
            console.log('✅ STK Push sent successfully!');
            
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    reference: reference,
                    order_id: order_id,
                    order_ref: orderRef,
                    status: 'pending',
                    phone: formattedPhone,
                    megaPayResult: megaPayResult
                }
            });
        } else {
            const errorMessage = megaPayResult.ResultDesc || 
                                megaPayResult.errorMessage || 
                                megaPayResult.message ||
                                'Unknown MegaPay error';
            
            console.error('❌ MegaPay error:', errorMessage);
            logPaymentEvent('STK_ERROR', { error: errorMessage, response: megaPayResult });
            
            // Update order with error
            try {
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
            } catch (updateError) {
                console.warn('⚠️ Failed to update order with error:', updateError);
            }
            
            return res.status(400).json({
                success: false,
                error: errorMessage,
                details: megaPayResult
            });
        }

    } catch (error) {
        console.error('❌ STK Push Error:', error);
        logPaymentEvent('STK_ERROR', { error: error.message });
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
        let reference = data.reference || data.Reference || data.order_ref || data.payment_reference || data.checkout_request_id;
        
        if (!reference) {
            console.warn('⚠️ No reference found in callback');
            return res.status(200).json({ 
                success: true, 
                message: 'No reference found - acknowledged'
            });
        }
        
        logPaymentEvent('CALLBACK_RECEIVED', { reference, body: data });

        // ─── FIND THE ORDER ──────────────────────────────────────
        let order = null;
        let findError = null;

        // Try by payment_reference
        const { data: orderByRef, error: refError } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .maybeSingle();

        if (refError) {
            console.error('❌ Error finding order by payment_reference:', refError);
        }

        if (orderByRef) {
            order = orderByRef;
            console.log(`✅ Found order by payment_reference: ${order.order_ref}`);
        } else {
            // Try by provider_reference
            const { data: orderByProviderRef, error: providerRefError } = await supabase
                .from('orders')
                .select('*')
                .eq('provider_reference', reference)
                .maybeSingle();

            if (providerRefError) {
                console.error('❌ Error finding order by provider_reference:', providerRefError);
            }

            if (orderByProviderRef) {
                order = orderByProviderRef;
                console.log(`✅ Found order by provider_reference: ${order.order_ref}`);
            }
        }

        if (!order) {
            console.error(`❌ Order not found for reference: ${reference}`);
            return res.status(200).json({ 
                success: true, 
                message: 'Order not found but acknowledged',
                reference: reference 
            });
        }

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

        // ─── CHECK PAYMENT STATUS ──────────────────────────────
        const isPaid = data.ResultCode === '0' || data.ResultCode === 0 ||
                      data.ResultCode === '00' ||
                      data.status === 'success' || data.status === 'completed' ||
                      data.ResultCode === 'SUCCESS' ||
                      data.ResultDesc === 'Success' ||
                      data.ResultDesc === 'The service request is processed successfully.' ||
                      data.PaymentStatus === 'Success' ||
                      data.payment_status === 'success';

        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        logPaymentEvent('CALLBACK_PAYMENT_STATUS', { isPaid, reference, order_id: order.id });

        // ─── UPDATE ORDER ──────────────────────────────────────────
        if (isPaid) {
            const transactionId = data.TransactionID || data.transaction_id || data.TransactionId || 'N/A';
            const amountPaid = data.Amount || data.amount || order.total_amount || 0;
            
            const updateData = {
                status: 'paid',
                payment_status: 'paid',
                payment_confirmed: true,
                payment_verified: true,
                provider_transaction_id: transactionId,
                provider_reference: reference,
                mpesa_transaction_id: transactionId,
                mpesa_code: transactionId,
                transaction_code: transactionId,
                confirmed_at: new Date().toISOString(),
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                callback_received_at: new Date().toISOString(),
                webhook_processed: true,
                amount_paid: amountPaid
            };

            const { error: updateError } = await supabase
                .from('orders')
                .update(updateData)
                .eq('id', order.id);

            if (updateError) {
                console.error('❌ Failed to update order:', updateError);
                logPaymentEvent('CALLBACK_UPDATE_ERROR', { error: updateError, order_id: order.id });
                return res.status(500).json({
                    success: false,
                    error: 'Failed to update order'
                });
            }

            logPaymentEvent('ORDER_MARKED_PAID', {
                order_id: order.id,
                order_ref: order.order_ref,
                reference: reference,
                transaction_id: transactionId,
                amount: amountPaid
            });

            console.log(`✅ Order ${order.order_ref} marked as PAID`);

            // ─── CREATE PAYMENT RECORD ──────────────────────────
            try {
                const paymentRecord = {
                    order_id: order.id,
                    provider: 'megapay',
                    provider_transaction_id: transactionId,
                    provider_reference: reference,
                    amount: amountPaid,
                    currency: 'KES',
                    status: 'paid',
                    phone: order.phone || data.msisdn,
                    customer_name: order.customer_name || data.customer_name,
                    customer_email: order.customer_email || data.customer_email,
                    raw_callback: data,
                    paid_at: new Date().toISOString()
                };

                const { error: paymentError } = await supabase
                    .from('payments')
                    .insert(paymentRecord);

                if (paymentError) {
                    console.error('❌ Failed to create payment record:', paymentError);
                } else {
                    console.log('✅ Payment record created');
                }
            } catch (paymentError) {
                console.error('❌ Payment record error:', paymentError);
            }

            // ─── FULFILL PURCHASE ──────────────────────────────
            try {
                await fulfillPurchase(order.id);
            } catch (fulfillError) {
                console.error('❌ Fulfillment error:', fulfillError);
                // Log but don't fail the webhook
                logPaymentEvent('FULFILLMENT_ERROR', { error: fulfillError.message, order_id: order.id });
            }

            return res.status(200).json({
                success: true,
                message: 'Payment processed successfully',
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'paid'
            });

        } else {
            // ─── PAYMENT FAILED ──────────────────────────────────
            const failureReason = data.ResultDesc || data.errorMessage || data.ResultDescription || 'Payment failed';

            const updateData = {
                status: 'failed',
                payment_status: 'failed',
                failure_reason: failureReason,
                payment_error: failureReason,
                updated_at: new Date().toISOString(),
                callback_received_at: new Date().toISOString(),
                webhook_processed: true
            };

            const { error: updateError } = await supabase
                .from('orders')
                .update(updateData)
                .eq('id', order.id);

            if (updateError) {
                console.error('❌ Failed to update order to failed:', updateError);
            }

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
        logPaymentEvent('CALLBACK_ERROR', { error: error.message });
        // Always return 200 to prevent MegaPay from retrying
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
        // Get order with items
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (orderError || !order) {
            throw new Error('Order not found');
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

        // For each item, grant access
        for (const item of items) {
            const resourceId = item.id || item.resource_id;
            if (!resourceId) continue;

            // Check if resource exists
            const { data: resource, error: resourceError } = await supabase
                .from('resources')
                .select('*')
                .eq('id', resourceId)
                .single();

            if (resourceError || !resource) {
                console.warn(`⚠️ Resource ${resourceId} not found`);
                continue;
            }

            // Log the purchase
            console.log(`✅ Resource ${resource.title} purchased`);
        }

        // Update order with fulfillment timestamp
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

// ─── VERIFY PAYMENT STATUS ──────────────────────────────────────────
app.get('/api/mpesa/verify/:reference', async (req, res) => {
    try {
        const { reference } = req.params;
        console.log(`🔍 Verifying payment: ${reference}`);

        const { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .maybeSingle();

        if (error || !order) {
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
                isPaid: isPaid,
                order_ref: order.order_ref
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

// ─── CHECK ORDER STATUS BY ID ──────────────────────────────────────
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

// ─── TEST CALLBACK ENDPOINT ──────────────────────────────────────
app.post('/api/mpesa/test-callback', async (req, res) => {
    console.log('🧪 Test callback received!');
    console.log('📥 Body:', req.body);
    
    const { order_ref, payment_reference, status, amount, transaction_id } = req.body;
    
    if (!order_ref && !payment_reference) {
        return res.status(400).json({
            success: false,
            error: 'Missing order_ref or payment_reference'
        });
    }
    
    try {
        let query = supabase.from('orders').select('*');
        if (order_ref) {
            query = query.eq('order_ref', order_ref);
        } else if (payment_reference) {
            query = query.eq('payment_reference', payment_reference);
        }
        
        const { data: order, error } = await query.single();
        
        if (error || !order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }
        
        const isPaid = status === 'paid' || status === 'success' || status === 'completed';
        
        const updateData = {
            status: isPaid ? 'paid' : 'failed',
            payment_status: isPaid ? 'paid' : 'failed',
            payment_confirmed: isPaid,
            payment_verified: isPaid,
            confirmed_at: isPaid ? new Date().toISOString() : null,
            paid_at: isPaid ? new Date().toISOString() : null,
            amount_paid: amount || order.total_amount || 0,
            mpesa_code: transaction_id || null,
            transaction_code: transaction_id || null,
            provider_transaction_id: transaction_id || null,
            updated_at: new Date().toISOString(),
            callback_received_at: new Date().toISOString()
        };

        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order.id);
        
        if (updateError) {
            return res.status(500).json({
                success: false,
                error: updateError.message
            });
        }
        
        logPaymentEvent('TEST_CALLBACK', { 
            order_ref: order.order_ref, 
            status: isPaid ? 'paid' : 'failed',
            transaction_id 
        });

        console.log(`✅ Test callback: Order ${order.order_ref} updated to ${isPaid ? 'PAID' : 'FAILED'}`);
        
        res.status(200).json({
            success: true,
            message: `Order ${order.order_ref} updated to ${isPaid ? 'PAID' : 'FAILED'}`,
            order: order,
            status: isPaid ? 'paid' : 'failed'
        });
        
    } catch (error) {
        console.error('❌ Test callback error:', error);
        res.status(500).json({
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
            health: 'GET /api/health',
            callback: 'POST /api/mpesa/callback',
            status: 'GET /api/mpesa/status/:orderId',
            verify: 'GET /api/mpesa/verify/:reference',
            test_callback: 'POST /api/mpesa/test-callback'
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
});

module.exports = app;
