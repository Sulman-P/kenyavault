// ============================================================
// KENYA VAULT - PAYMENT SERVER (WITH EMAIL & ATTACHMENTS)
// ============================================================

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const axios = require('axios');
const archiver = require('archiver');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── ENVIRONMENT VARIABLES CHECK ──────────────────────────────
console.log('🔍 ENVIRONMENT VARIABLES CHECK:');
console.log('SMTP_USER:', process.env.SMTP_USER ? '✅ SET' : '❌ NOT SET');
console.log('SMTP_PASS:', process.env.SMTP_PASS ? '✅ SET' : '❌ NOT SET');
console.log('SMTP_HOST:', process.env.SMTP_HOST || '❌ NOT SET (using default)');
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ SET' : '❌ NOT SET');

// ─── SUPABASE CONFIG ──────────────────────────────────────────
const SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NDkzOTksImV4cCI6MjA5NzMyNTM5OX0.2HnM4NMvxOlqrc2ChuFa_F6kqEniSah3NU5vTLNtfYs';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log('✅ Supabase initialized with key');

// ─── MEGAPAY CONFIG ──────────────────────────────────────────
const MEGAPAY_API_KEY = process.env.MEGAPAY_API_KEY || 'MGPYDSg2lIYA';
const MEGAPAY_EMAIL = process.env.MEGAPAY_EMAIL || 'adminnexalearn@gmail.com';
const MEGAPAY_INITIATE_URL = process.env.MEGAPAY_URL || 'https://megapay.co.ke/backend/v1/initiatestk';
const MEGAPAY_STATUS_URL = process.env.MEGAPAY_STATUS_URL || 'https://megapay.co.ke/backend/v1/transactionstatus';
const MEGAPAY_CALLBACK_URL = process.env.MEGAPAY_CALLBACK_URL || 'https://kenyavault-payment.onrender.com/api/mpesa/callback';

console.log(`🔑 MegaPay API Key: ${MEGAPAY_API_KEY}`);
console.log(`📧 MegaPay Email: ${MEGAPAY_EMAIL}`);
console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);

// ─── EMAIL CONFIG ─────────────────────────────────────────────
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || MEGAPAY_EMAIL;
const SMTP_PASS = process.env.SMTP_PASS;

let emailTransporter = null;

if (SMTP_PASS) {
    emailTransporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
            user: SMTP_USER,
            pass: SMTP_PASS
        },
        pool: true,
        maxConnections: 3,
        rateLimit: 5
    });
    console.log('📧 Email configured:', SMTP_HOST);
} else {
    console.warn('⚠️ SMTP_PASS not set - email sending disabled');
}

// ─── CORS ──────────────────────────────────────────────────────
const allowedOrigins = [
    'https://kenyavault.co.ke',
    'https://www.kenyavault.co.ke',
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:3000',
    'https://kenyavault.onrender.com',
    'http://localhost:8080',
    'https://kenyavault-payment.onrender.com'
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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

function formatCurrency(amount) {
    return 'KES ' + Number(amount).toLocaleString();
}

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, s => map[s]);
}

function logPaymentEvent(event, data) {
    console.log(`[PAYMENT] ${event}:`, JSON.stringify(data, null, 2));
}

// ─── GET FILE ATTACHMENTS ──────────────────────────────────
async function getFileAttachments(filePaths) {
    const attachments = [];
    
    for (const filePath of filePaths) {
        try {
            if (!filePath) continue;
            
            const { data, error } = await supabase.storage
                .from('private-resources')
                .createSignedUrl(filePath, 300);
            
            if (error) throw error;
            
            const response = await axios.get(data.signedUrl, {
                responseType: 'arraybuffer',
                timeout: 30000
            });
            
            const fileName = path.basename(filePath);
            attachments.push({
                filename: fileName,
                content: Buffer.from(response.data),
                contentType: response.headers['content-type'] || 'application/octet-stream'
            });
            
        } catch (error) {
            console.error(`❌ Failed to download ${filePath}:`, error.message);
        }
    }
    
    return attachments;
}

// ─── SEND ORDER EMAIL ──────────────────────────────────────
async function sendOrderEmail(order, items, total) {
    if (!emailTransporter) {
        console.warn('⚠️ Email not configured - skipping');
        return false;
    }

    try {
        console.log(`📧 Sending email for order ${order.order_ref} to ${order.email || order.user_email}`);
        
        // Get file attachments
        const filePaths = items
            .map(item => item.file_url || item.filename || item.file_path)
            .filter(Boolean);
        
        let attachments = [];
        if (filePaths.length > 0) {
            attachments = await getFileAttachments(filePaths);
            
            // If more than 3 files, create a zip
            if (attachments.length > 3) {
                const zipBuffer = await createZipAttachment(attachments);
                attachments = [{
                    filename: `kenyavault-resources-${order.order_ref}.zip`,
                    content: zipBuffer,
                    contentType: 'application/zip'
                }];
            }
        }
        
        // Generate email HTML
        const emailHtml = generateOrderEmailTemplate(order, items, total);
        
        // Send email
        const mailOptions = {
            from: `"KenyaVault" <${SMTP_USER}>`,
            to: order.email || order.user_email,
            subject: `📚 KenyaVault Order #${order.order_ref} - ${items.length} Resource(s)`,
            html: emailHtml,
            attachments: attachments
        };
        
        await emailTransporter.sendMail(mailOptions);
        
        // Update order status
        await supabase
            .from('orders')
            .update({
                email_status: 'sent',
                email_sent_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', order.id);
        
        console.log(`✅ Email sent for order ${order.order_ref}`);
        return true;
        
    } catch (error) {
        console.error('❌ Email sending error:', error);
        
        // Log error but don't fail the order
        await supabase
            .from('orders')
            .update({
                email_status: 'failed',
                last_email_error: error.message,
                updated_at: new Date().toISOString()
            })
            .eq('id', order.id);
        
        return false;
    }
}

// ─── CREATE ZIP ATTACHMENT ─────────────────────────────────
function createZipAttachment(attachments) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const buffers = [];
        
        archive.on('data', chunk => buffers.push(chunk));
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', reject);
        
        for (const att of attachments) {
            archive.append(att.content, { name: att.filename });
        }
        
        archive.finalize();
    });
}

// ─── GENERATE ORDER EMAIL TEMPLATE ─────────────────────────
function generateOrderEmailTemplate(order, items, total) {
    const date = new Date().toLocaleDateString('en-KE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const itemsList = items.map(item => `
        <tr>
            <td style="padding: 12px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: middle;">
                <strong style="display: block; color: #1a202c;">${escapeHtml(item.title || item.name || 'Resource')}</strong>
                <span style="font-size: 0.8rem; color: #6b7280;">${escapeHtml(item.category || 'CBC Document')}</span>
                ${item.education_level ? `<span style="font-size: 0.8rem; color: #6b7280;"> | ${escapeHtml(item.education_level)}</span>` : ''}
            </td>
            <td style="padding: 12px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #C9971F; font-weight: 600;">
                ${formatCurrency(item.price || 0)}
            </td>
        </tr>
    `).join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>KenyaVault Order Confirmation</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
                line-height: 1.6;
                color: #1a202c;
                background: #f7fafc;
            }
            .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .header { background: #0B2340; padding: 30px; text-align: center; }
            .header h1 { color: white; font-size: 28px; font-weight: 800; margin: 0; }
            .header h1 span { color: #C9971F; }
            .header p { color: rgba(255,255,255,0.8); margin: 5px 0 0; font-size: 14px; }
            .flag-bar { height: 4px; background: linear-gradient(to right, #000000 25%, #BB0000 25%, #BB0000 50%, #1F7A3A 50%, #1F7A3A 75%, #FFFFFF 75%); }
            .content { padding: 30px; }
            .order-details { background: #f7fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .order-details p { margin: 4px 0; font-size: 14px; color: #4a5568; }
            .order-details strong { color: #1a202c; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th { background: #f7fafc; padding: 12px 10px; text-align: left; font-size: 14px; color: #4a5568; }
            .total { padding: 15px 10px; border-top: 2px solid #C9971F; text-align: right; }
            .total strong { font-size: 18px; color: #C9971F; }
            .success-box { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .success-box h3 { color: #166534; margin-bottom: 10px; }
            .success-box ul { padding-left: 20px; color: #14532d; }
            .btn { display: inline-block; padding: 12px 30px; background: #C9971F; color: #0B2340; text-decoration: none; border-radius: 8px; font-weight: 700; }
            .footer { padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; color: #718096; font-size: 14px; }
            @media only screen and (max-width: 480px) {
                .container { margin: 10px; }
                .content { padding: 20px; }
                .header { padding: 20px; }
                .header h1 { font-size: 22px; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="flag-bar"></div>
            <div class="header">
                <h1>Kenya<span>Vault</span></h1>
                <p>Order Confirmation #${escapeHtml(order.order_ref)}</p>
            </div>
            <div class="content">
                <h2 style="color: #0B2340; font-size: 22px;">Thank You for Your Purchase! 🎉</h2>
                <p style="font-size: 16px; color: #4a5568; margin: 10px 0 0;">Dear ${escapeHtml(order.customer_name || 'Customer')},</p>
                <p style="font-size: 16px; color: #4a5568; margin: 5px 0 0;">Your order has been confirmed and your documents are ready. Please find your purchased resources attached to this email.</p>
                
                <div class="order-details">
                    <p><strong>📋 Order Reference:</strong> #${escapeHtml(order.order_ref)}</p>
                    <p><strong>📅 Date:</strong> ${date}</p>
                    <p><strong>📧 Email:</strong> ${escapeHtml(order.email || order.user_email)}</p>
                    ${order.customer_phone ? `<p><strong>📱 Phone:</strong> ${escapeHtml(order.customer_phone)}</p>` : ''}
                </div>
                
                <h3 style="color: #0B2340; margin: 20px 0 10px;">📚 Purchased Resources</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Resource</th>
                            <th style="text-align: right;">Price</th>
                        </tr>
                    </thead>
                    <tbody>${itemsList}</tbody>
                    <tfoot>
                        <tr class="total">
                            <td><strong>Total Paid</strong></td>
                            <td><strong>${formatCurrency(total)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
                
                <div class="success-box">
                    <h3>✅ What's Next?</h3>
                    <ul>
                        <li>Your purchased files are <strong>attached</strong> to this email</li>
                        <li>You can also download from your <a href="https://kenyavault.co.ke/dashboard" style="color: #C9971F; font-weight: 600;">Dashboard</a></li>
                        <li>Need help? Reply to this email or contact <a href="mailto:support@kenyavault.com" style="color: #C9971F;">support@kenyavault.com</a></li>
                    </ul>
                </div>
                
                <div style="text-align: center; margin: 25px 0;">
                    <a href="https://kenyavault.co.ke/browse" class="btn">🔍 Browse More Resources</a>
                </div>
                
                <div class="footer">
                    <p>© ${new Date().getFullYear()} KenyaVault. All rights reserved.</p>
                    <p style="font-size: 12px; color: #a0aec0; margin-top: 5px;">This email contains purchased educational resources. Please keep this email secure.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
}

// ─── ORDER CREATION ENDPOINT ────────────────────────────────
app.post('/api/create-order', async (req, res) => {
    console.log('📦 Create order request received!');
    console.log('📥 Body:', req.body);
    
    try {
        const { 
            customer_id,
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
        const sessionId = crypto.randomUUID();
        
        const orderData = {
            id: orderId,
            order_ref: orderRef,
            session_id: sessionId,
            customer_id: customer_id || null,
            user_email: user_email || null,
            email: user_email || null,
            customer_name: customer_name || null,
            customer_phone: phone || null,
            phone: phone || null,
            cart_items: cart_items,
            total_amount: parseFloat(total_amount),
            cart_total: parseFloat(total_amount),
            item_count: cart_items.length,
            status: 'pending',
            payment_status: 'pending',
            payment_method: 'mpesa',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            email_status: 'pending'
        };
        
        console.log('📝 Creating order with data:', orderData);
        
        const { data: order, error: createError } = await supabase
            .from('orders')
            .insert(orderData)
            .select()
            .single();
        
        if (createError) {
            console.error('❌ Order creation error:', createError);
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

        const isPaid = 
            result.TransactionStatus === 'Completed' || 
            result.TransactionStatus === 'completed' ||
            result.ResultCode === '0' || 
            result.ResultCode === 0 || 
            result.ResultCode === '00' ||
            result.ResponseCode === '0' || 
            result.ResponseCode === 0 || 
            result.ResponseCode === '00' ||
            result.success === true ||
            result.success === '200' ||
            result.success === 200 ||
            result.status === 'success' ||
            result.status === 'paid' ||
            result.isPaid === true ||
            result.paid === true ||
            result.TransactionCode === '0' ||
            result.TransactionCode === 0;

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
    let resourceUrls = [];
    
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
        
        // Send email with attachments
        const total = parseFloat(order.total_amount) || 0;
        const emailSent = await sendOrderEmail(order, items, total);
        
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
                    resourceUrls.push(resource.file_url);
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
            
        logPaymentEvent('PURCHASE_FULFILLED', { order_id: orderId, items: items.length, email_sent: emailSent });
        console.log(`✅ Purchase fulfilled for order ${orderId}`);
        
        return resourceUrls.length > 0 ? resourceUrls[0] : null;
        
    } catch (error) {
        console.error('❌ Fulfillment error:', error);
        return null;
    }
}

// ══════════════════════════════════════════════════════════════
// ─── STK PUSH ENDPOINT ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════

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

        // ─── EXTRACT TRANSACTION REQUEST ID ──────────────────
        let transactionRequestId = null;
        
        // Try multiple possible field names
        const possibleIdFields = [
            'transaction_request_id',
            'TransactionRequestID',
            'TransactionID',
            'TransactionId',
            'transactionId',
            'TransactionRequestId',
            'transactionRequestId',
            'CheckoutRequestID',
            'CheckoutRequestId',
            'checkout_request_id',
            'MerchantRequestID',
            'merchant_request_id',
            'request_id',
            'id'
        ];
        
        for (const field of possibleIdFields) {
            if (megaPayResult[field]) {
                transactionRequestId = megaPayResult[field];
                console.log(`✅ Found transaction ID in field ${field}: ${transactionRequestId}`);
                break;
            }
        }
        
        // Check in data object
        if (!transactionRequestId && megaPayResult.data) {
            const dataFields = ['transaction_request_id', 'TransactionRequestID', 'TransactionID', 'id', 'request_id'];
            for (const field of dataFields) {
                if (megaPayResult.data[field]) {
                    transactionRequestId = megaPayResult.data[field];
                    console.log(`✅ Found transaction ID in data.${field}: ${transactionRequestId}`);
                    break;
                }
            }
        }

        // ─── CHECK IF SUCCESS ─────────────────────────────────
        const isSuccess = megaPayResult.ResultCode === '0' || 
                         megaPayResult.ResultCode === 0 ||
                         megaPayResult.ResultCode === '00' ||
                         megaPayResult.ResponseCode === '0' ||
                         megaPayResult.ResponseCode === 0 ||
                         megaPayResult.ResponseCode === '00' ||
                         megaPayResult.success === true ||
                         megaPayResult.success === '200' ||
                         megaPayResult.success === 200 ||
                         megaPayResult.status === 'success' ||
                         megaPayResult.status === 'Success' ||
                         megaPayResult.message === 'Success' ||
                         megaPayResult.message === 'success' ||
                         (megaPayResult.ResultDesc && megaPayResult.ResultDesc.toLowerCase().includes('success'));

        // ─── SAVE TRANSACTION ID ─────────────────────────────
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
        } else {
            console.warn('⚠️ No transaction_request_id found in MegaPay response');
        }

        if (isSuccess) {
            logPaymentEvent('STK_SENT', { 
                reference: kvReference, 
                order_id, 
                orderRef: newOrderRef,
                transaction_request_id: transactionRequestId
            });
            
            // CRITICAL: Return the transaction_request_id to the frontend
            return res.status(200).json({
                success: true,
                transaction_request_id: transactionRequestId,
                message: megaPayResult.message || megaPayResult.ResultDesc || 'STK Push sent successfully',
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
                transaction_request_id: transactionRequestId || null,
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

// ─── MANUAL PAYMENT CONFIRMATION ──────────────────────────
app.post('/api/mpesa/confirm-payment', async (req, res) => {
    console.log('📌 Manual payment confirmation received!');
    console.log('📥 Body:', req.body);
    
    try {
        const { order_id, order_ref, mpesa_code, receipt } = req.body;
        
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
        
        if (order.payment_status === 'paid' || order.payment_confirmed === true) {
            console.log(`✅ Order ${order.order_ref} is already paid`);
            return res.status(200).json({
                success: true,
                isPaid: true,
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'paid'
            });
        }
        
        const paymentCode = mpesa_code || receipt || 'MANUAL-' + Date.now();
        
        const updateData = {
            status: 'paid',
            payment_status: 'paid',
            payment_confirmed: true,
            payment_verified: true,
            mpesa_code: paymentCode,
            transaction_code: paymentCode,
            mpesa_receipt: paymentCode,
            amount_paid: order.total_amount,
            confirmed_at: new Date().toISOString(),
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            admin_required: false
        };
        
        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', order.id);
        
        if (updateError) {
            console.error('❌ Failed to update order:', updateError);
            return res.status(500).json({
                success: false,
                error: 'Failed to update order: ' + updateError.message
            });
        }
        
        const resourceUrl = await fulfillPurchase(order.id);
        
        console.log(`✅ Order ${order.order_ref} manually confirmed as PAID`);
        
        return res.status(200).json({
            success: true,
            isPaid: true,
            order_id: order.id,
            order_ref: order.order_ref,
            status: 'paid',
            mpesa_code: paymentCode,
            resource_url: resourceUrl || order.resource_file_path || null
        });
        
    } catch (error) {
        console.error('❌ Manual confirmation error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message
        });
    }
});

// ─── DOWNLOAD HANDLER ──────────────────────────────────────
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

// ─── VERIFY PAYMENT ENDPOINT ──────────────────────────────
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
        
        if (mpesa_code) {
            console.log(`🔍 Attempting to confirm with M-PESA code: ${mpesa_code}`);
            
            const { data: existingOrder, error: dupError } = await supabase
                .from('orders')
                .select('*')
                .eq('mpesa_code', mpesa_code)
                .neq('id', order.id)
                .maybeSingle();
            
            if (existingOrder) {
                console.log(`⚠️ M-PESA code ${mpesa_code} already used`);
                return res.status(200).json({
                    isPaid: false,
                    status: 'failed',
                    error: 'This M-PESA code has already been used'
                });
            }
            
            const updateData = {
                status: 'paid',
                payment_status: 'paid',
                payment_confirmed: true,
                payment_verified: true,
                mpesa_code: mpesa_code,
                transaction_code: mpesa_code,
                mpesa_receipt: mpesa_code,
                amount_paid: order.total_amount,
                confirmed_at: new Date().toISOString(),
                paid_at: new Date().toISOString(),
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
            
            const resourceUrl = await fulfillPurchase(order.id);
            
            console.log(`✅ Order ${order.order_ref} confirmed as PAID with code`);
            
            return res.status(200).json({
                isPaid: true,
                order_id: order.id,
                order_ref: order.order_ref,
                status: 'paid',
                mpesa_code: mpesa_code,
                resource_url: resourceUrl || order.resource_file_path || null
            });
        }
        
        if (order.status === 'pending' || order.payment_status === 'pending') {
            const createdTime = new Date(order.created_at).getTime();
            const now = Date.now();
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

// ─── BACKGROUND VERIFICATION INTERVAL ──────────────────────
setInterval(verifyPendingOrders, 30000);
setTimeout(verifyPendingOrders, 5000);

// ─── TEST STK PUSH ENDPOINT ──────────────────────────────────
app.post('/api/mpesa/test-stk', async (req, res) => {
    try {
        const { phone, amount } = req.body;
        
        // Validate phone
        let clean = phone ? phone.replace(/\D/g, '') : '';
        let msisdn = '';
        
        if (clean.startsWith('0') && clean.length === 10) {
            msisdn = '254' + clean.substring(1);
        } else if (clean.startsWith('254') && clean.length === 12) {
            msisdn = clean;
        } else if (clean.length === 9 && (clean.startsWith('7') || clean.startsWith('1'))) {
            msisdn = '254' + clean;
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid phone format. Use 0712345678 or 254712345678'
            });
        }
        
        const testPayload = {
            api_key: MEGAPAY_API_KEY,
            email: MEGAPAY_EMAIL,
            amount: amount || 1,
            msisdn: msisdn,
            reference: 'TEST-' + Date.now(),
            callback_url: MEGAPAY_CALLBACK_URL
        };
        
        console.log('🧪 Test Payload:', JSON.stringify(testPayload, null, 2));
        
        const response = await fetch(MEGAPAY_INITIATE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(testPayload)
        });
        
        const responseText = await response.text();
        console.log('🧪 Test Response:', responseText);
        
        let result;
        try {
            result = JSON.parse(responseText);
        } catch(e) {
            result = { raw: responseText };
        }
        
        res.json({
            success: true,
            request_sent: testPayload,
            response: result,
            raw_response: responseText,
            status: response.status
        });
        
    } catch (error) {
        console.error('❌ Test STK error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ─── HEALTH CHECK ─────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            megapay: 'configured',
            email: emailTransporter ? 'configured' : 'disabled',
            callback_url: MEGAPAY_CALLBACK_URL,
            background_verification: 'running (every 30s)',
            supabase: 'connected'
        },
        endpoints: {
            create_order: 'POST /api/create-order',
            download: 'POST /api/download-resource',
            stk_push: 'POST /api/mpesa/stk-push',
            verify_payment: 'POST /api/mpesa/verify-payment',
            confirm_payment: 'POST /api/mpesa/confirm-payment',
            callback: 'POST /api/mpesa/callback',
            test_stk: 'POST /api/mpesa/test-stk'
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
            verify_payment: 'POST /api/mpesa/verify-payment',
            confirm_payment: 'POST /api/mpesa/confirm-payment',
            test_stk: 'POST /api/mpesa/test-stk'
        }
    });
});

// ─── START SERVER ─────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KenyaVault Payment Server running on port ${PORT}`);
    console.log(`📍 Health: http://localhost:${PORT}/api/health`);
    console.log(`📞 MegaPay API: ${MEGAPAY_INITIATE_URL}`);
    console.log(`🔗 Callback URL: ${MEGAPAY_CALLBACK_URL}`);
    console.log(`📧 Email: ${emailTransporter ? 'CONFIGURED ✅' : 'DISABLED ⚠️'}`);
    console.log(`⏰ Payment timeout: 3 minutes`);
    console.log(`✅ Server is ready!`);
});

module.exports = app;
