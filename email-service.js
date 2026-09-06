// email-service.js - Deploy on your Render.com backend
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(express.json());

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Email configuration - Use professional email service
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  pool: true, // Use pooled connections
  maxConnections: 5,
  rateLimit: 10 // Max emails per second
});

// In-memory email queue
const emailQueue = [];
let isProcessingQueue = false;

// Process email queue
async function processEmailQueue() {
  if (isProcessingQueue || emailQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (emailQueue.length > 0) {
    const job = emailQueue.shift();
    try {
      await sendEmailWithAttachments(job.to, job.subject, job.html, job.attachments);
      await updateOrderStatus(job.orderId, 'email_sent');
      console.log(`✅ Email sent for order ${job.orderId}`);
    } catch (error) {
      console.error(`❌ Failed to send email for order ${job.orderId}:`, error);
      // Retry logic - add back to queue if failed
      if (job.retryCount < 3) {
        job.retryCount = (job.retryCount || 0) + 1;
        emailQueue.push(job);
      }
    }
    
    // Rate limiting - prevent overwhelming SMTP server
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  isProcessingQueue = false;
}

// Function to fetch and attach files
async function getFileAttachments(filePaths) {
  const attachments = [];
  
  for (const filePath of filePaths) {
    try {
      // Get signed URL from Supabase
      const { data, error } = await supabase.storage
        .from('private-resources')
        .createSignedUrl(filePath, 300); // 5 minutes
    
      if (error) throw error;
      
      // Download file from signed URL
      const response = await axios.get(data.signedUrl, {
        responseType: 'arraybuffer'
      });
      
      const fileName = path.basename(filePath);
      attachments.push({
        filename: fileName,
        content: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'application/octet-stream'
      });
      
    } catch (error) {
      console.error(`❌ Failed to download file ${filePath}:`, error);
      // Continue with other files
    }
  }
  
  return attachments;
}

// Main email sending function
async function sendEmailWithAttachments(to, subject, htmlContent, attachments = []) {
  const mailOptions = {
    from: `"KenyaVault" <${process.env.SMTP_USER}>`,
    to: to,
    subject: subject,
    html: htmlContent,
    attachments: attachments
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

// API Endpoint: Send order confirmation with files
app.post('/api/send-order-email', async (req, res) => {
  try {
    const { orderId, orderRef, email, items, total } = req.body;
    
    if (!orderId || !email || !items || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Fetch order details from Supabase
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    
    if (error) throw error;
    
    // Get file URLs from order cart_items
    const filePaths = order.cart_items.map(item => item.filename).filter(Boolean);
    
    // Download files for attachment
    const attachments = await getFileAttachments(filePaths);
    
    // Generate professional email HTML template
    const emailHtml = generateOrderEmailTemplate(order, items, total);
    
    // Add to queue with attachments
    emailQueue.push({
      orderId: orderId,
      to: email,
      subject: `📚 Your KenyaVault Order #${orderRef} - ${items.length} Resource(s)`,
      html: emailHtml,
      attachments: attachments,
      retryCount: 0
    });
    
    // Start processing queue if not already running
    processEmailQueue();
    
    // Update order status
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
      attachmentsCount: attachments.length
    });
    
  } catch (error) {
    console.error('❌ Email queue error:', error);
    res.status(500).json({ 
      error: 'Failed to queue email',
      details: error.message 
    });
  }
});

// Generate professional email template
function generateOrderEmailTemplate(order, items, total) {
  const date = new Date().toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const itemsList = items.map(item => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb;">
        <strong>${escapeHtml(item.title)}</strong>
        <br>
        <span style="font-size: 0.875rem; color: #6b7280;">${escapeHtml(item.category || 'CBC Document')}</span>
        ${item.education_level ? `<span style="font-size: 0.875rem; color: #6b7280;"> | ${escapeHtml(item.education_level)}</span>` : ''}
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">
        ${formatCurrency(item.price)}
      </td>
    </tr>
  `).join('');
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #1a202c; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #0B2340; color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .header h1 span { color: #C9971F; }
        .content { background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
        .order-details { background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .total { font-size: 20px; font-weight: bold; color: #C9971F; text-align: right; padding: 15px 0; border-top: 2px solid #C9971F; }
        .button { display: inline-block; padding: 12px 24px; background: #C9971F; color: #0B2340; text-decoration: none; border-radius: 6px; font-weight: bold; }
        .footer { text-align: center; padding: 20px; font-size: 14px; color: #6b7280; border-top: 1px solid #e5e7eb; margin-top: 20px; }
        .flag-stripe { height: 4px; background: linear-gradient(to right, #000000 25%, #BB0000 25%, #BB0000 50%, #1F7A3A 50%, #1F7A3A 75%, #FFFFFF 75%); }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="flag-stripe"></div>
        <div class="header">
          <h1>Kenya<span>Vault</span></h1>
          <p style="margin: 5px 0 0; opacity: 0.8;">Order Confirmation #${escapeHtml(order.order_ref)}</p>
        </div>
        <div class="content">
          <h2 style="color: #0B2340;">Thank You for Your Purchase! 🎉</h2>
          <p>Dear Customer,</p>
          <p>Your order has been confirmed and your documents are ready. Please find your purchased resources attached to this email.</p>
          
          <div class="order-details">
            <strong>Order Details:</strong><br>
            Order Reference: #${escapeHtml(order.order_ref)}<br>
            Date: ${date}<br>
            Email: ${escapeHtml(order.customer_email)}<br>
            Phone: ${escapeHtml(order.customer_phone || 'N/A')}
          </div>
          
          <h3 style="color: #0B2340;">Purchased Resources:</h3>
          <table>
            <thead>
              <tr style="background: #f3f4f6;">
                <th style="padding: 10px; text-align: left;">Resource</th>
                <th style="padding: 10px; text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsList}
            </tbody>
            <tfoot>
              <tr>
                <td style="padding: 15px 0; font-weight: bold;">Total</td>
                <td style="padding: 15px 0; text-align: right; font-weight: bold; color: #C9971F;">${formatCurrency(total)}</td>
              </tr>
            </tfoot>
          </table>
          
          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <strong style="color: #166534;">📥 What's Next?</strong>
            <ul style="margin: 10px 0 0; padding-left: 20px;">
              <li>Your purchased files are attached to this email</li>
              <li>You can also download them from your <a href="https://kenyavault.com/dashboard" style="color: #C9971F;">dashboard</a></li>
              <li>Need help? Reply to this email or contact us at support@kenyavault.com</li>
            </ul>
          </div>
          
          <p style="margin-top: 20px;">
            <a href="https://kenyavault.com/browse" class="button">Browse More Resources</a>
          </p>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} KenyaVault. All rights reserved.</p>
            <p style="font-size: 12px; color: #9ca3af;">
              This email contains purchased educational resources. Please keep this email secure.
            </p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Helper functions
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCurrency(amount) {
  return 'KES ' + Number(amount).toLocaleString();
}

// Health check endpoint
app.get('/api/email-health', (req, res) => {
  res.json({
    status: 'healthy',
    queueLength: emailQueue.length,
    isProcessing: isProcessingQueue,
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`📧 Email service running on port ${PORT}`);
  console.log(`SMTP Host: ${process.env.SMTP_HOST}`);
});
