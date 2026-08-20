// ============================================================
// KENYA VAULT - COMPLETE PAYMENT SERVER
// ============================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================================
// CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NDkzOTksImV4cCI6MjA5NzMyNTM5OX0.2HnM4NMvxOlqrc2ChuFa_F6kqEniSah3NU5vTLNtfYs'; // Replace with your service role key

const MEGAPAY_API_KEY = 'MGPYDSg2lIYA';
const MEGAPAY_API_URL = 'https://megapay.co.ke/backend/initiatestk';
const MEGAPAY_CALLBACK_URL = 'https://kenyavault.co.ke/api/mpesa/callback';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors({
    origin: ['http://localhost:5500', 'https://kenyavault.co.ke', 'https://www.kenyavault.co.ke'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function generateTransactionReference() {
    const timestamp = Date.now().toString().slice(-8);
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `KV-${timestamp}-${random}`;
}

function validatePhoneNumber(phone) {
    let cleaned = phone.replace(/\D/g, '');
    
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    }
    
    if (cleaned.startsWith('254') && cleaned.length === 12) {
        return cleaned;
    }
    
    if (phone.startsWith('+254')) {
        return phone.substring(1);
    }
    
    return null;
}

// ============================================================
// 1. CREATE ORDER AND INITIATE PAYMENT
// ============================================================
app.post('/api/checkout/initiate', async (req, res) => {
    try {
        const {
            customer_name,
            customer_email,
            phone,
            resource_id,
            resource_title,
            amount,
            resource_data
        } = req.body;

        // Validate required fields
        if (!customer_name || !phone || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: name, phone, amount'
            });
        }

        // Validate phone number
        const formattedPhone = validatePhoneNumber(phone);
        if (!formattedPhone) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number. Use 07XXXXXXXX or 2547XXXXXXXX'
            });
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount'
            });
        }

        // Create order in database - using 'amount' column
        const orderData = {
            customer_name: customer_name,
            customer_email: customer_email || null,
            phone: formattedPhone,
            resource_ids: resource_id ? [resource_id] : [],
            resource_count: resource_id ? 1 : 0,
            amount: numericAmount,  // ← USING 'amount' column
            currency: 'KES',
            status: 'pending',
            payment_method: 'mpesa',
            payment_verified: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: {
                resource_id: resource_id,
                resource_title: resource_title,
                resource_data: resource_data || {},
                source: 'checkout',
                initiated_at: new Date().toISOString()
            }
        };

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert([orderData])
            .select()
            .single();

        if (orderError) {
            console.error('❌ Order creation error:', orderError);
            return res.status(500).json({
                success: false,
                error: 'Failed to create order: ' + orderError.message
            });
        }

        // Generate transaction reference
        const reference = generateTransactionReference();

        // Update order with reference
        const { error: refError } = await supabase
            .from('orders')
            .update({ payment_reference: reference })
            .eq('id', order.id);

        if (refError) {
            console.error('❌ Reference update error:', refError);
        }

        // Prepare MegaPay request
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            phone: formattedPhone,
            amount: numericAmount,
            reference: reference,
            callback: MEGAPAY_CALLBACK_URL,
            description: `Payment for ${resource_title || 'KenyaVault resource'}`
        };

        console.log('📤 MegaPay Request:', megaPayPayload);

        // Call MegaPay API
        const megaPayResponse = await fetch(MEGAPAY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(megaPayPayload)
        });

        const megaPayResult = await megaPayResponse.json();

        console.log('📥 MegaPay Response:', megaPayResult);

        // Store MegaPay response in order metadata
        const { error: metaError } = await supabase
            .from('orders')
            .update({
                metadata: {
                    ...order.metadata,
                    mega_pay_request: megaPayPayload,
                    mega_pay_response: megaPayResult,
                    transaction_reference: reference
                }
            })
            .eq('id', order.id);

        if (metaError) {
            console.error('❌ Metadata update error:', metaError);
        }

        // Check if MegaPay was successful
        if (megaPayResult.status === 'success' || megaPayResult.success === true) {
            return res.status(200).json({
                success: true,
                message: 'STK Push sent successfully',
                data: {
                    order_id: order.id,
                    reference: reference,
                    status: 'pending',
                    check_interval: 3
                }
            });
        } else {
            // MegaPay failed - update order status
            await supabase
                .from('orders')
                .update({ status: 'failed' })
                .eq('id', order.id);

            return res.status(400).json({
                success: false,
                error: megaPayResult.message || 'Failed to initiate payment',
                details: megaPayResult
            });
        }

    } catch (error) {
        console.error('❌ Checkout error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ============================================================
// 2. CHECK ORDER STATUS
// ============================================================
app.get('/api/checkout/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: 'Order ID required'
            });
        }

        const { data: order, error } = await supabase
            .from('orders')
            .select('status, payment_verified, payment_reference, amount, metadata')
            .eq('id', orderId)
            .single();

        if (error || !order) {
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: {
                status: order.status,
                payment_verified: order.payment_verified || false,
                payment_reference: order.payment_reference,
                amount: order.amount
            }
        });

    } catch (error) {
        console.error('❌ Status check error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// ============================================================
// 3. M-PESA CALLBACK
// ============================================================
app.post('/api/mpesa/callback', async (req, res) => {
    try {
        console.log('📥 M-Pesa Callback Received:');
        console.log(JSON.stringify(req.body, null, 2));

        const {
            reference,
            status,
            transaction_id,
            amount,
            phone,
            result_code,
            result_description
        } = req.body;

        // Find order by reference
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('payment_reference', reference)
            .single();

        if (orderError || !order) {
            console.error('❌ Order not found for reference:', reference);
            return res.status(404).json({
                success: false,
                error: 'Order not found'
            });
        }

        // Determine payment status
        let orderStatus = 'failed';
        let paymentVerified = false;

        if (status === 'completed' || status === 'success' || result_code === '0' || result_code === 0) {
            orderStatus = 'paid';
            paymentVerified = true;
        } else if (status === 'pending' || status === 'processing') {
            orderStatus = 'pending';
        } else {
            orderStatus = 'failed';
        }

        // Update order
        const updateData = {
            status: orderStatus,
            payment_verified: paymentVerified,
            payment_verified_at: paymentVerified ? new Date().toISOString() : null,
            metadata: {
                ...order.metadata,
                callback_data: {
                    reference,
                    status,
                    transaction_id,
                    amount,
                    phone,
                    result_code,
                    result_description,
                    received_at: new Date().toISOString()
                }
            },
            updated_at: new Date().toISOString()
        };

        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order.id);

        if (updateError) {
            console.error('❌ Update error:', updateError);
            return res.status(500).json({
                success: false,
                error: 'Failed to update order'
            });
        }

        // Grant access if payment verified
        if (paymentVerified && order.resource_ids && order.resource_ids.length > 0) {
            await grantResourceAccess(order.id, order.resource_ids);
        }

        console.log(`✅ Payment processed: ${reference} -> ${orderStatus}`);

        return res.status(200).json({
            success: true,
            message: 'Callback processed',
            order_id: order.id,
            status: orderStatus
        });

    } catch (error) {
        console.error('❌ Callback error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// ============================================================
// 4. GRANT RESOURCE ACCESS
// ============================================================
async function grantResourceAccess(orderId, resourceIds) {
    try {
        for (let i = 0; i < resourceIds.length; i++) {
            const resourceId = resourceIds[i];
            
            // Update download count
            const { data: resource } = await supabase
                .from('resources')
                .select('download_count')
                .eq('id', resourceId)
                .single();

            const currentCount = resource?.download_count || 0;

            await supabase
                .from('resources')
                .update({
                    download_count: currentCount + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('id', resourceId);

            console.log(`✅ Updated download count for resource ${resourceId}`);
        }

        // Create access record
        await supabase
            .from('resource_downloads')
            .insert({
                resource_id: resourceIds[0],
                order_id: orderId,
                user_type: 'customer',
                created_at: new Date().toISOString()
            });

        return true;

    } catch (error) {
        console.error('❌ Grant access error:', error);
        return false;
    }
});

// ============================================================
// 5. HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            megapay: 'configured',
            supabase: 'configured'
        }
    });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔗 Callback: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`🔑 MegaPay: ${MEGAPAY_API_KEY.substring(0, 8)}...`);
});

module.exports = app;
