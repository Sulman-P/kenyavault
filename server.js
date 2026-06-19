// server.js
const express = require('express');
const cors = require('cors');
const megapayService = require('./services/megapayService');

const app = express();
app.use(cors());
app.use(express.json());

// ── INITIATE PAYMENT ──
app.post('/api/payment/initiate', async (req, res) => {
  const { phoneNumber, amount, resourceId, resourceTitle } = req.body;

  // Validate inputs
  if (!phoneNumber || !amount) {
    return res.status(400).json({ 
      success: false, 
      error: 'Phone number and amount are required' 
    });
  }

  if (amount < 1) {
    return res.status(400).json({
      success: false,
      error: 'Amount must be at least KES 1'
    });
  }

  // Generate reference
  const reference = `KV-${resourceId || Date.now()}`;
  const description = resourceTitle || 'KenyaVault Purchase';

  try {
    const result = await megapayService.initiatePayment(
      phoneNumber,
      amount,
      reference,
      description
    );

    if (result.success) {
      // Store transaction in database
      // await saveTransaction({ checkoutId, resourceId, phoneNumber, amount, status: 'pending' });

      res.json({
        success: true,
        checkoutId: result.checkoutId,
        message: 'Payment initiated. Check your phone for M-PESA prompt.'
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// ── PAYMENT CALLBACK ──
app.post('/api/payment/callback', async (req, res) => {
  console.log('📨 Megapay callback received:', req.body);

  const { checkoutId, status, amount, mpesaCode, phoneNumber } = req.body;

  // IMPORTANT: Always acknowledge the callback
  res.json({ ResultCode: 0, ResultDesc: 'Success' });

  // Process payment result
  if (status === 'success' || status === 'completed') {
    console.log(`✅ Payment successful! Checkout ID: ${checkoutId}`);
    console.log(`📱 M-PESA Code: ${mpesaCode}`);
    console.log(`💰 Amount: ${amount}`);
    console.log(`👤 Phone: ${phoneNumber}`);

    // 1. Update database: mark order as paid
    // await updateOrderStatus(checkoutId, 'paid', mpesaCode);

    // 2. Grant access to resource
    // await grantResourceAccess(checkoutId);

    // 3. Send download link via WhatsApp
    // await sendWhatsAppLink(phoneNumber, downloadUrl);

  } else if (status === 'failed' || status === 'cancelled') {
    console.log(`❌ Payment failed: ${checkoutId}`);
    // await updateOrderStatus(checkoutId, 'failed');
  }
});

// ── CHECK PAYMENT STATUS ──
app.get('/api/payment/status/:checkoutId', async (req, res) => {
  const { checkoutId } = req.params;

  try {
    const result = await megapayService.queryPaymentStatus(checkoutId);

    if (result.success) {
      res.json({
        success: true,
        status: result.status,
        data: result.data
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

app.listen(3000, () => {
  console.log('🚀 Server running on port 3000');
  console.log(`📱 Callback URL: ${MEGAPAY_CONFIG.callbackUrl}`);
});
