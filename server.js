// ============================================================
// KENYA VAULT - PAYMENT SERVER (SIMPLIFIED & FIXED)
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

// ─── STK PUSH ENDPOINT ──────────────────────────────────────────────
app.post('/api/mpesa/stk-push', async (req, res) => {
    console.log('🚀 STK Push endpoint called!');
    console.log('📥 Request body:', req.body);
    
    try {
        const { phone, amount, order_id, order_ref, customer_name, customer_email } = req.body;

        // Validate
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

        // ─── GENERATE REFERENCES ──────────────────────────────────
        const kvReference = generateTransactionReference(); // KV-XXXXXXXX-XXXX
        const orderRef = order_ref || generateOrderRef(); // ORD-20260821-XXXXX

        logPaymentEvent('STK_INITIATED', { 
            phone: formattedPhone, 
            amount: numericAmount, 
            kvReference,
            orderRef,
            order_id
        });

        // ─── UPDATE ORDER WITH REFERENCES ──────────────────────────
        // IMPORTANT: Save BOTH references before sending to MegaPay
        const { error: updateError } = await supabase
            .from('orders')
            .update({
                order_ref: orderRef,
                payment_reference: kvReference,
                provider_reference: kvReference, // Set to same value initially
                payment_status: 'pending',
                updated_at: new Date().toISOString()
            })
            .eq('id', order_id);

        if (updateError) {
            console.error('❌ Error updating order:', updateError);
            return res.status(500).json({
                success: false,
                error: 'Failed to update order'
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

        // ─── CHECK MEGAPAY RESPONSE ──────────────────────────────
        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.ResultCode === '00' ||
                         megaPayResult.status === 'success' || 
                         megaPayResult.success === true ||
                         megaPayResult.ResultCode === 'SUCCESS';

        if (isSuccess) {
            // ─── GET MEGAPAY'S REFERENCE ──────────────────────────
            let megaPayRef = null;
            if (megaPayResult.data && megaPayResult.data.reference) {
                megaPayRef = megaPayResult.data.reference;
            } else if (megaPayResult.Reference) {
                megaPayRef = megaPayResult.Reference;
            } else if (megaPayResult.reference) {
                megaPayRef = megaPayResult.reference;
            }

            // If MegaPay returned a different reference, update it
            if (megaPayRef && megaPayRef !== kvReference) {
                console.log(`🔄 MegaPay used different reference: ${megaPayRef}`);
                await supabase
                    .from('orders')
                    .update({
                        provider_reference: megaPayRef,
                        payment_reference: megaPayRef, // Also update payment_reference to match
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', order_id);
                
                console.log(`✅ Updated order with MegaPay reference: ${megaPayRef}`);
            }

            logPaymentEvent('STK_SENT', { reference: kvReference, order_id, orderRef });
            
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    reference: kvReference,
                    order_id: order_id,
                    order_ref: orderRef,
                    status: 'pending',
                    phone: formattedPhone,
                    megaPayReference: megaPayRef || kvReference
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

// ─── MEGAPAY CALLBACK / WEBHOOK ──────────────────────────────────
app.post('/api/mpesa/callback', async (req, res) => {
    console.log('📥 MegaPay Callback received!');
    console.log('📥 Headers:', JSON.stringify(req.headers, null, 2));
    console.log('📥 Body:', JSON.stringify(req.body, null, 2));

    try {
        const data = req.body;
        
        // ─── EXTRACT REFERENCE ──────────────────────────────────
        let reference = data.reference || data.Reference || data.order_ref || data.payment_reference || data.checkout_request_id;
        
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
        
        // Try ALL possible reference fields
        const searchFields = [
            { field: 'provider_reference', label: 'provider_reference' },
            { field: 'payment_reference', label: 'payment_reference' },
            { field: 'order_ref', label: 'order_ref' },
            { field: 'transaction_reference', label: 'transaction_reference' }
        ];
        
        for (const search of searchFields) {
            if (order) break;
            
            const { data: found, error } = await supabase
                .from('orders')
                .select('*')
                .eq(search.field, reference)
                .maybeSingle();
            
            if (found) {
                order = found;
                console.log(`✅ Found order by ${search.label}: ${order.order_ref}`);
                break;
            }
        }
        
        // If still not found, try to find by partial match (KV-XXXXXXXX-XXXX)
        if (!order && reference.startsWith('KV-')) {
            const { data: partialMatch, error } = await supabase
                .from('orders')
                .select('*')
                .like('payment_reference', `%${reference}%`)
                .maybeSingle();
            
            if (partialMatch) {
                order = partialMatch;
                console.log(`✅ Found order by partial match: ${order.order_ref}`);
            }
        }
        
        if (!order) {
            console.log(`❌ Order not found for reference: ${reference}`);
            
            // Log recent orders for debugging
            const { data: recentOrders, error: recentError } = await supabase
                .from('orders')
                .select('order_ref, payment_reference, provider_reference, status, created_at')
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(5);
            
            console.log('📋 Recent pending orders:', recentOrders);
            
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
        
        // ─── DETERMINE PAYMENT STATUS ──────────────────────────────
        const isPaid = data.ResultCode === '0' || data.ResultCode === 0 || 
                      data.ResultCode === '00' || data.status === 'success' ||
                      data.ResultCode === 'SUCCESS' ||
                      data.ResultDesc === 'Success' ||
                      data.ResultDesc === 'The service request is processed successfully.' ||
                      data.PaymentStatus === 'Success' ||
                      data.payment_status === 'success';
        
        console.log(`💰 Payment ${isPaid ? 'PAID ✅' : 'FAILED ❌'}`);
        
        if (isPaid) {
            const transactionId = data.TransactionID || data.transaction_id || data.TransactionId || 'N/A';
            const amountPaid = data.Amount || data.amount || order.total_amount || 0;
            
            // ─── UPDATE ORDER TO PAID ──────────────────────────────
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
                amount_paid: amountPaid,
                confirmed_at: new Date().toISOString(),
                paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                callback_received_at: new Date().toISOString()
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
                status: 'paid'
            });

        } else {
            // ─── PAYMENT FAILED ──────────────────────────────────
            const failureReason = data.ResultDesc || data.errorMessage || 'Payment failed';

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

// ─── FIX ORDERS ENDPOINT ──────────────────────────────────────────
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

// ─── VERIFY PAYMENT ──────────────────────────────────────────────
app.get('/api/mpesa/verify/:reference', async (req, res) => {
    try {
        const { reference } = req.params;
        console.log(`🔍 Verifying payment: ${reference}`);

        // Search in multiple fields
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

// ─── TEST CALLBACK ──────────────────────────────────────────────
app.post('/api/mpesa/test-callback', async (req, res) => {
    console.log('🧪 Test callback received!');
    console.log('📥 Body:', req.body);
    
    const { reference, order_ref, status, amount, transaction_id } = req.body;
    
    if (!reference && !order_ref) {
        return res.status(400).json({
            success: false,
            error: 'Missing reference or order_ref'
        });
    }
    
    try {
        let order = null;
        let searchRef = reference || order_ref;
        
        const { data: found, error } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', searchRef)
            .maybeSingle();
        
        if (found) {
            order = found;
        } else {
            const { data: foundByProvider, error: providerError } = await supabase
                .from('orders')
                .select('*')
                .eq('provider_reference', searchRef)
                .maybeSingle();
            
            if (foundByProvider) {
                order = foundByProvider;
            }
        }
        
        if (!order) {
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

        await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order.id);
        
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
            test_callback: 'POST /api/mpesa/test-callback',
            fix_orders: 'POST /api/mpesa/fix-orders'
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
