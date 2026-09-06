// email-service.js - Complete email system with multiple providers
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://rewpminmqnrtwdvglxxr.supabase.co',
  process.env.SUPABASE_ANON_KEY
);

// ─── EMAIL PROVIDER CONFIGURATION ───
const EMAIL_CONFIG = {
  // Primary: SMTP (Gmail, Outlook, etc.)
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  },
  // Backup: SendGrid
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY,
    from: process.env.SENDGRID_FROM_EMAIL
  },
  // Backup: Mailgun
  mailgun: {
    apiKey: process.env.MAILGUN_API_KEY,
    domain: process.env.MAILGUN_DOMAIN,
    from: process.env.MAILGUN_FROM_EMAIL
  }
};

// ─── CREATE TRANSPORTERS ───
let primaryTransporter = null;
let backupTransporter = null;

function createSMTPTransporter() {
  try {
    return nodemailer.createTransport({
      host: EMAIL_CONFIG.smtp.host,
      port: EMAIL_CONFIG.smtp.port,
      secure: EMAIL_CONFIG.smtp.secure,
      auth: EMAIL_CONFIG.smtp.auth,
      pool: true,
      maxConnections: 5,
      rateLimit: 10,
      tls: {
        rejectUnauthorized: false
      }
    });
  } catch (error) {
    console.error('❌ Failed to create SMTP transporter:', error);
    return null;
  }
}

// ─── SEND EMAIL WITH FALLBACK ───
async function sendEmailWithFallback(to, subject, htmlContent, attachments = []) {
  // Try primary SMTP first
  try {
    if (!primaryTransporter) {
      primaryTransporter = createSMTPTransporter();
    }
    
    if (primaryTransporter) {
      const result = await sendViaSMTP(primaryTransporter, to, subject, htmlContent, attachments);
      console.log('✅ Email sent via SMTP');
      return { success: true, provider: 'smtp', result };
    }
  } catch (error) {
    console.error('❌ SMTP failed, trying backup providers:', error.message);
  }

  // Try SendGrid as backup
  try {
    if (EMAIL_CONFIG.sendgrid.apiKey) {
      const result = await sendViaSendGrid(to, subject, htmlContent, attachments);
      console.log('✅ Email sent via SendGrid');
      return { success: true, provider: 'sendgrid', result };
    }
  } catch (error) {
    console.error('❌ SendGrid failed:', error.message);
  }

  // Try Mailgun as last resort
  try {
    if (EMAIL_CONFIG.mailgun.apiKey) {
      const result = await sendViaMailgun(to, subject, htmlContent, attachments);
      console.log('✅ Email sent via Mailgun');
      return { success: true, provider: 'mailgun', result };
    }
  } catch (error) {
    console.error('❌ Mailgun failed:', error.message);
  }

  // All providers failed
  throw new Error('All email providers failed');
}

// ─── SMTP SENDER ───
async function sendViaSMTP(transporter, to, subject, htmlContent, attachments) {
  const mailOptions = {
    from: `"KenyaVault" <${EMAIL_CONFIG.smtp.auth.user}>`,
    to: to,
    subject: subject,
    html: htmlContent,
    attachments: attachments.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType || 'application/octet-stream'
    }))
  };

  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        reject(error);
      } else {
        resolve(info);
      }
    });
  });
}

// ─── SENDGRID SENDER ───
async function sendViaSendGrid(to, subject, htmlContent, attachments) {
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(EMAIL_CONFIG.sendgrid.apiKey);

  const msg = {
    to: to,
    from: EMAIL_CONFIG.sendgrid.from,
    subject: subject,
    html: htmlContent,
    attachments: attachments.map(att => ({
      content: att.content.toString('base64'),
      filename: att.filename,
      type: att.contentType,
      disposition: 'attachment'
    }))
  };

  return await sgMail.send(msg);
}

// ─── MAILGUN SENDER ───
async function sendViaMailgun(to, subject, htmlContent, attachments) {
  const formData = new FormData();
  formData.append('from', EMAIL_CONFIG.mailgun.from);
  formData.append('to', to);
  formData.append('subject', subject);
  formData.append('html', htmlContent);

  for (const att of attachments) {
    formData.append('attachment', att.content, {
      filename: att.filename,
      contentType: att.contentType
    });
  }

  const response = await axios.post(
    `https://api.mailgun.net/v3/${EMAIL_CONFIG.mailgun.domain}/messages`,
    formData,
    {
      auth: {
        username: 'api',
        password: EMAIL_CONFIG.mailgun.apiKey
      },
      headers: formData.getHeaders()
    }
  );

  return response.data;
}

// ─── GET FILE ATTACHMENTS ───
async function getFileAttachments(filePaths) {
  const attachments = [];
  
  for (const filePath of filePaths) {
    try {
      if (!filePath) continue;
      
      // Get signed URL from Supabase
      const { data, error } = await supabase.storage
        .from('private-resources')
        .createSignedUrl(filePath, 300);
    
      if (error) throw error;
      
      // Download file
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

// ─── CREATE ZIP ATTACHMENT ───
async function createZipAttachment(filePaths) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const buffers = [];
    
    archive.on('data', chunk => buffers.push(chunk));
    archive.on('end', () => {
      resolve({
        filename: `kenyavault-resources-${Date.now()}.zip`,
        content: Buffer.concat(buffers),
        contentType: 'application/zip'
      });
    });
    archive.on('error', reject);
    
    for (const file of filePaths) {
      if (file.content) {
        archive.append(file.content, { name: file.filename });
      }
    }
    
    archive.finalize();
  });
}

// ─── GENERATE EMAIL HTML TEMPLATE ───
function generateOrderEmailTemplate(order, items, total) {
  const date = new Date().toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const itemsList = items.map(item => `
    <tr>
      <td style="padding: 12px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: middle;">
        <strong style="display: block; color: #1a202c;">${escapeHtml(item.title)}</strong>
        <span style="font-size: 0.8rem; color: #6b7280;">${escapeHtml(item.category || 'CBC Document')}</span>
        ${item.education_level ? `<span style="font-size: 0.8rem; color: #6b7280;"> | ${escapeHtml(item.education_level)}</span>` : ''}
      </td>
      <td style="padding: 12px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #C9971F; font-weight: 600;">
        ${formatCurrency(item.price)}
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
      .footer .social { margin: 10px 0; }
      .footer .social a { color: #0B2340; margin: 0 8px; text-decoration: none; }
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
        <p style="font-size: 16px; color: #4a5568; margin: 10px 0 0;">Dear Customer,</p>
        <p style="font-size: 16px; color: #4a5568; margin: 5px 0 0;">Your order has been confirmed and your documents are ready. Please find your purchased resources attached to this email.</p>
        
        <div class="order-details">
          <p><strong>📋 Order Reference:</strong> #${escapeHtml(order.order_ref)}</p>
          <p><strong>📅 Date:</strong> ${date}</p>
          <p><strong>📧 Email:</strong> ${escapeHtml(order.customer_email)}</p>
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
            <li>You can also download from your <a href="https://kenyavault.com/dashboard" style="color: #C9971F; font-weight: 600;">Dashboard</a></li>
            <li>Need help? Reply to this email or contact <a href="mailto:support@kenyavault.com" style="color: #C9971F;">support@kenyavault.com</a></li>
          </ul>
        </div>
        
        <div style="text-align: center; margin: 25px 0;">
          <a href="https://kenyavault.com/browse" class="btn">🔍 Browse More Resources</a>
        </div>
        
        <div class="footer">
          <p style="margin-bottom: 10px;">Follow us for updates:</p>
          <div class="social">
            <a href="https://twitter.com/kenyavault">Twitter</a> |
            <a href="https://facebook.com/kenyavault">Facebook</a> |
            <a href="https://youtube.com/kenyavault">YouTube</a>
          </div>
          <p>© ${new Date().getFullYear()} KenyaVault. All rights reserved.</p>
          <p style="font-size: 12px; color: #a0aec0; margin-top: 5px;">This email contains purchased educational resources. Please keep this email secure.</p>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

// ─── HELPER FUNCTIONS ───
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

function formatCurrency(amount) {
  return 'KES ' + Number(amount).toLocaleString();
}

// ─── EMAIL QUEUE ───
const emailQueue = [];
let isProcessingQueue = false;

async function processEmailQueue() {
  if (isProcessingQueue || emailQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (emailQueue.length > 0) {
    const job = emailQueue.shift();
    try {
      const result = await sendEmailWithFallback(
        job.to,
        job.subject,
        job.html,
        job.attachments
      );
      
      // Update order status
      await supabase
        .from('orders')
        .update({
          email_status: 'sent',
          email_sent_at: new Date().toISOString(),
          email_provider: result.provider
        })
        .eq('id', job.orderId);
      
      console.log(`✅ Email sent for order ${job.orderId} via ${result.provider}`);
      
    } catch (error) {
      console.error(`❌ Failed to send email for order ${job.orderId}:`, error.message);
      
      if (job.retryCount < 3) {
        job.retryCount = (job.retryCount || 0) + 1;
        job.nextRetry = Date.now() + (job.retryCount * 60000); // Retry after 1, 2, 3 minutes
        emailQueue.push(job);
        
        await supabase
          .from('orders')
          .update({
            email_status: 'retrying',
            email_attempts: job.retryCount,
            last_email_error: error.message
          })
          .eq('id', job.orderId);
      } else {
        await supabase
          .from('orders')
          .update({
            email_status: 'failed',
            last_email_error: error.message
          })
          .eq('id', job.orderId);
      }
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  isProcessingQueue = false;
}

// ─── API ENDPOINTS ───

// Send order email
app.post('/api/send-order-email', async (req, res) => {
  try {
    const { orderId, orderRef, email, items, total } = req.body;
    
    if (!orderId || !email || !items || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Fetch order details
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    
    if (error) throw error;
    
    // Get file paths
    const filePaths = order.cart_items
      .map(item => item.filename)
      .filter(Boolean);
    
    // Download files
    const attachments = await getFileAttachments(filePaths);
    
    // Create ZIP file if multiple attachments
    let finalAttachments = attachments;
    if (attachments.length > 3) {
      const zip = await createZipAttachment(attachments);
      finalAttachments = [zip];
    }
    
    // Generate email
    const emailHtml = generateOrderEmailTemplate(order, items, total);
    
    // Add to queue
    emailQueue.push({
      orderId: orderId,
      to: email,
      subject: `📚 KenyaVault Order #${orderRef} - ${items.length} Resource(s)`,
      html: emailHtml,
      attachments: finalAttachments,
      retryCount: 0
    });
    
    // Process queue
    processEmailQueue();
    
    // Update order
    await supabase
      .from('orders')
      .update({
        email_status: 'queued',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);
    
    res.json({
      success: true,
      message: 'Email queued for sending',
      orderId: orderId,
      attachmentsCount: finalAttachments.length
    });
    
  } catch (error) {
    console.error('❌ Email queue error:', error);
    res.status(500).json({
      error: 'Failed to queue email',
      details: error.message
    });
  }
});

// Test email configuration
app.post('/api/test-email', async (req, res) => {
  try {
    const { to, subject, message } = req.body;
    
    if (!to) {
      return res.status(400).json({ error: 'Email address required' });
    }
    
    const testHtml = `
      <h1>KenyaVault Email Test</h1>
      <p>${message || 'This is a test email from KenyaVault.'}</p>
      <p>Sent at: ${new Date().toISOString()}</p>
      <p>If you received this, your email configuration is working!</p>
    `;
    
    const result = await sendEmailWithFallback(to, subject || 'KenyaVault Email Test', testHtml, []);
    
    res.json({
      success: true,
      message: 'Test email sent successfully',
      provider: result.provider
    });
    
  } catch (error) {
    console.error('Test email failed:', error);
    res.status(500).json({
      error: 'Test email failed',
      details: error.message
    });
  }
});

// Get email status
app.get('/api/email-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const { data, error } = await supabase
      .from('orders')
      .select('email_status, email_sent_at, email_attempts, last_email_error')
      .eq('id', orderId)
      .single();
    
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/email-health', (req, res) => {
  res.json({
    status: 'healthy',
    queueLength: emailQueue.length,
    isProcessing: isProcessingQueue,
    providers: {
      smtp: !!primaryTransporter,
      sendgrid: !!EMAIL_CONFIG.sendgrid.apiKey,
      mailgun: !!EMAIL_CONFIG.mailgun.apiKey
    },
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`📧 KenyaVault Email Service running on port ${PORT}`);
  console.log(`SMTP: ${EMAIL_CONFIG.smtp.host}:${EMAIL_CONFIG.smtp.port}`);
  console.log(`SendGrid: ${!!EMAIL_CONFIG.sendgrid.apiKey ? 'Configured' : 'Not configured'}`);
  console.log(`Mailgun: ${!!EMAIL_CONFIG.mailgun.apiKey ? 'Configured' : 'Not configured'}`);
});
