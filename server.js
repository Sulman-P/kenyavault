// ============================================================
// KENYA VAULT - M-PESA STK PUSH WITH MEGAPAY
// Backend Server (Node.js + Express)
// ============================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================================
// CONFIGURATION - UPDATED WITH YOUR CREDENTIALS
// ============================================================
const PORT = process.env.PORT || 3000;

// Supabase Configuration
const SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = ' '; // Replace with your service role key

// MegaPay Configuration - UPDATED
const MEGAPAY_API_KEY = 'MGPYDSg2lIYA';
const MEGAPAY_API_URL = 'https://megapay.co.ke/backend/initiatestk';
const MEGAPAY_CALLBACK_URL = 'https://kenyavault.co.ke/api/mpesa/callback';

// Initialize Supabase client with service role for RLS bypass
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
    // Remove any non-digit characters
    let cleaned = phone.replace(/\D/g, '');
    
    // Check if it starts with 0, replace with 254
    if (cleaned.startsWith('0')) {
        cleaned = '254' + cleaned.substring(1);
    }
    
    // Check if it starts with 254
    if (cleaned.startsWith('254') && cleaned.length === 12) {
        return cleaned;
    }
    
    // Check if it already has 254 format but with +
    if (phone.startsWith('+254')) {
        return phone.substring(1);
    }
    
    return null;
}

// ============================================================
// 1. INITIATE STK PUSH
// ============================================================
app.post('/api/mpesa/initiate', async (req, res) => {
    try {
        const { phone, amount, order_id, customer_name, customer_email, resource_ids } = req.body;

        // Validate required fields
        if (!phone || !amount || !order_id) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: phone, amount, order_id'
            });
        }

        // Validate phone number
        const formattedPhone = validatePhoneNumber(phone);
        if (!formattedPhone) {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone number format. Use 2547XXXXXXXX or 07XXXXXXXX'
            });
        }

        // Validate amount
        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount. Must be a positive number.'
            });
        }

        // Generate unique reference
        const reference = generateTransactionReference();

        // Prepare MegaPay request
        const megaPayPayload = {
            api_key: MEGAPAY_API_KEY,
            phone: formattedPhone,
            amount: numericAmount,
            reference: reference,
            callback: MEGAPAY_CALLBACK_URL,
            description: `Payment for order ${order_id}`
        };

        console.log('📤 Initiating STK Push:', {
            phone: formattedPhone,
            amount: numericAmount,
            reference: reference,
            order_id: order_id
        });

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

        // Update order in database with payment details
        const updateData = {
            status: 'pending',
            payment_method: 'mpesa',
            payment_reference: reference,
            metadata: {
                transaction_reference: reference,
                mega_pay_request: megaPayPayload,
                mega_pay_response: megaPayResult,
                phone: formattedPhone,
                customer_name: customer_name || null,
                customer_email: customer_email || null,
                resource_ids: resource_ids || [],
                initiated_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
        };

        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order_id);

        if (updateError) {
            console.error('Error updating order:', updateError);
        }

        // Check if MegaPay request was successful
        // MegaPay returns: { status: "success", message: "STK Push sent", ... }
        if (megaPayResult.status === 'success' || megaPayResult.success === true) {
            return res.status(200).json({
                success: true,
                message: 'STK Push initiated successfully',
                data: {
                    reference: reference,
                    order_id: order_id,
                    check_interval: 3,
                    status: 'pending',
                    mega_pay_response: megaPayResult
                }
            });
        } else {
            // MegaPay returned an error
            return res.status(400).json({
                success: false,
                error: megaPayResult.message || megaPayResult.error || 'Failed to initiate STK Push',
                details: megaPayResult
            });
        }

    } catch (error) {
        console.error('❌ STK Push Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error. Please try again.',
            details: error.message
        });
    }
});

// ============================================================
// 2. M-PESA CALLBACK HANDLER
// ============================================================
app.post('/api/mpesa/callback', async (req, res) => {
    try {
        console.log('📥 Received M-Pesa Callback');
        console.log('Callback Body:', JSON.stringify(req.body, null, 2));

        const {
            reference,
            status,
            transaction_id,
            amount,
            phone,
            transaction_time,
            result_code,
            result_description
        } = req.body;

        // Find the order by reference
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
        let statusMessage = 'Payment verification failed';

        // Check if payment was successful
        if (status === 'completed' || 
            status === 'success' || 
            result_code === '0' ||
            result_code === 0) {
            orderStatus = 'paid';
            paymentVerified = true;
            statusMessage = 'Payment verified successfully';
        } else if (status === 'pending' || status === 'processing') {
            orderStatus = 'pending';
            statusMessage = 'Payment is being processed';
        } else {
            orderStatus = 'failed';
            statusMessage = result_description || 'Payment failed';
        }

        // Update order with callback data
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
                    transaction_time,
                    result_code,
                    result_description,
                    received_at: new Date().toISOString()
                }
            },
            updated_at: new Date().toISOString()
        };

        // If payment verified, update the order status
        if (paymentVerified) {
            updateData.status = 'paid';
        }

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

        // If payment is verified, grant resource access
        if (paymentVerified && order.resource_ids && order.resource_ids.length > 0) {
            await grantResourceAccess(order.id, order.resource_ids);
        }

        console.log(`✅ Payment callback processed: ${reference} -> ${orderStatus}`);

        // Respond to MegaPay with success
        return res.status(200).json({
            success: true,
            message: 'Callback processed successfully',
            order_id: order.id,
            status: orderStatus
        });

    } catch (error) {
        console.error('❌ Callback Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

// ============================================================
// 3. GRANT RESOURCE ACCESS
// ============================================================
async function grantResourceAccess(orderId, resourceIds) {
    try {
        console.log(`📚 Granting access to ${resourceIds.length} resources for order ${orderId}`);

        for (let i = 0; i < resourceIds.length; i++) {
            const resourceId = resourceIds[i];
            
            const { data: resource, error: resourceError } = await supabase
                .from('resources')
                .select('download_count')
                .eq('id', resourceId)
                .single();

            if (resourceError) {
                console.error(`❌ Error finding resource ${resourceId}:`, resourceError);
                continue;
            }

            const currentCount = resource?.download_count || 0;

            const { error: updateError } = await supabase
                .from('resources')
                .update({
                    download_count: currentCount + 1,
                    updated_at: new Date().toISOString()
                })
                .eq('id', resourceId);

            if (updateError) {
                console.error(`❌ Error updating download count for ${resourceId}:`, updateError);
            } else {
                console.log(`✅ Updated download count for resource ${resourceId}`);
            }
        }

        return true;

    } catch (error) {
        console.error('❌ Grant access error:', error);
        return false;
    }
}

// ============================================================
// 4. CHECK ORDER STATUS (for polling)
// ============================================================
app.get('/api/mpesa/status/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: 'Order ID is required'
            });
        }

        const { data: order, error } = await supabase
            .from('orders')
            .select('status, payment_verified, payment_reference, metadata')
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
                metadata: order.metadata
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
// 5. CREATE ORDER (initiate payment flow)
// ============================================================
app.post('/api/orders/create', async (req, res) => {
    try {
        const {
            customer_name,
            customer_email,
            phone,
            resource_ids,
            amount,
            currency = 'KES'
        } = req.body;

        if (!customer_name || !phone || !resource_ids || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        const orderData = {
            customer_name,
            customer_email: customer_email || null,
            phone,
            resource_ids,
            resource_count: resource_ids.length,
            amount: parseFloat(amount),
            currency,
            status: 'pending',
            payment_verified: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            metadata: {
                resource_ids: resource_ids,
                source: 'checkout',
                created_at: new Date().toISOString()
            }
        };

        const { data: order, error: orderError } = await supabase
            .from('orders')
            .insert([orderData])
            .select()
            .single();

        if (orderError) {
            console.error('❌ Error creating order:', orderError);
            return res.status(500).json({
                success: false,
                error: 'Failed to create order'
            });
        }

        // Initiate STK Push
        const initiateResponse = await fetch(`http://localhost:${PORT}/api/mpesa/initiate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: phone,
                amount: amount,
                order_id: order.id,
                customer_name: customer_name,
                customer_email: customer_email,
                resource_ids: resource_ids
            })
        });

        const initiateResult = await initiateResponse.json();

        return res.status(200).json({
            success: true,
            data: {
                order: order,
                payment: initiateResult
            }
        });

    } catch (error) {
        console.error('❌ Create order error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// ============================================================
// 6. HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            megapay: 'configured',
            supabase: 'configured',
            callback_url: MEGAPAY_CALLBACK_URL
        }
    });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📞 MegaPay API: ${MEGAPAY_API_URL}`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`🔑 MegaPay API Key: ${MEGAPAY_API_KEY.substring(0, 8)}...`);
});

module.exports = app;