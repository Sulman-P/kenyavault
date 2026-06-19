// ======================================================
// KENYAVAULT - CLOUDFLARE WORKER WITH MEGAPAY INTEGRATION
// ======================================================

export default {
  async fetch(request, env) {
    // ── ACCESS ENVIRONMENT VARIABLES ──
    // At the top of your index.js
const MEGAPAY_CONFIG = {
  API_KEY: 'MGPYDSg2lIYA',
  PAYBILL: '522522',
  ACCOUNT: 'KenyaVault',
  BASE_URL: 'https://api.megapay.co.ke/api/v1',
  CALLBACK_URL: 'https://kcsevault.odhiambosulman3.workers.dev/api/payment/callback'
};

// Then use MEGAPAY_CONFIG everywhere in your code

    // HARDCODED CREDENTIALS (since they're provided)
    const MEGAPAY_API_SECRET = 'MGPYDSg2lIYA';
    const PAYBILL = '522522';
    const ACCOUNT_NAME = 'SULMAN';

    console.log('✅ Megapay Integration Active');
    console.log(`✅ Paybill: ${PAYBILL}`);
    console.log(`✅ Account: ${ACCOUNT_NAME}`);

    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── HOME / STATUS ──
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        status: 'KenyaVault API Running',
        paybill: PAYBILL,
        account: ACCOUNT_NAME,
        endpoints: [
          '/api/payment/initiate',
          '/api/payment/callback',
          '/api/payment/status/:checkoutId'
        ]
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // ── INITIATE PAYMENT ──
    if (url.pathname === '/api/payment/initiate' && request.method === 'POST') {
      try {
        const { phoneNumber, amount, resourceId, resourceTitle } = await request.json();

        console.log('📤 Payment Initiation Request:', { phoneNumber, amount, resourceId });

        // Validate inputs
        if (!phoneNumber || !amount) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Phone number and amount are required'
          }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        if (amount < 1) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Amount must be at least KES 1'
          }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // Format phone number to 2547XXXXXXXX
        const formattedPhone = phoneNumber.replace(/^0/, '254').replace(/^\+/, '');
        
        if (!formattedPhone.startsWith('254') || formattedPhone.length !== 12) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Invalid phone number. Use 0712345678 or 254712345678'
          }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        // Generate reference
        const reference = `KV-${resourceId || Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const description = resourceTitle || 'KenyaVault Resource Purchase';

        // Prepare payload for Megapay
        const payload = {
          phoneNumber: formattedPhone,
          amount: Math.round(amount),
          accountReference: reference,
          transactionDesc: description.substring(0, 36),
          paybill: PAYBILL,
          callbackUrl: MEGAPAY_CALLBACK_URL || 'https://kcsevault.odhiambosulman3.workers.dev/api/payment/callback',
          accountName: ACCOUNT_NAME
        };

        console.log('📤 Sending to Megapay:', payload);

        // Send to Megapay
        const response = await fetch(`${MEGAPAY_BASE_URL}/stk/push`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': MEGAPAY_API_KEY,
            'X-API-Secret': MEGAPAY_API_SECRET
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        console.log('📨 Megapay Response:', data);

        // Extract checkout ID from response
        const checkoutId = data.checkoutId || data.transactionId || data.id || null;

        if (data.status === 'success' || data.success || data.ResponseCode === '0' || checkoutId) {
          return new Response(JSON.stringify({
            success: true,
            checkoutId: checkoutId,
            message: 'Payment initiated. Check your phone for M-PESA prompt.',
            reference: reference
          }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } else {
          return new Response(JSON.stringify({
            success: false,
            error: data.message || data.error || 'Payment initiation failed'
          }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

      } catch (error) {
        console.error('❌ Payment error:', error);
        return new Response(JSON.stringify({
          success: false,
          error: error.message || 'Payment service error'
        }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // ── PAYMENT CALLBACK ──
    if (url.pathname === '/api/payment/callback' && request.method === 'POST') {
      try {
        const callback = await request.json();
        console.log('📨 Megapay Callback Received:', JSON.stringify(callback, null, 2));

        // Extract payment details
        const {
          checkoutId,
          transactionId,
          status,
          amount,
          mpesaCode,
          phoneNumber,
          accountReference,
          ResultCode,
          ResultDesc
        } = callback;

        // Determine payment status
        const isSuccess = status === 'success' || 
                         status === 'completed' || 
                         ResultCode === '0' ||
                         callback.success === true;

        if (isSuccess) {
          console.log(`✅ Payment SUCCESSFUL!`);
          console.log(`📱 M-PESA Code: ${mpesaCode || callback.MpesaReceiptNumber || 'N/A'}`);
          console.log(`💰 Amount: ${amount || callback.Amount || 'N/A'}`);
          console.log(`👤 Phone: ${phoneNumber || callback.PhoneNumber || 'N/A'}`);
          console.log(`📋 Reference: ${accountReference || callback.AccountReference || 'N/A'}`);

          // Here you would:
          // 1. Update your database
          // 2. Grant access to the resource
          // 3. Send WhatsApp message with download link

          // You can trigger a WhatsApp message using the Megapay API or manually

        } else {
          console.log(`❌ Payment FAILED: ${ResultDesc || status || 'Unknown reason'}`);
        }

        // Always acknowledge the callback
        return new Response(JSON.stringify({
          ResultCode: 0,
          ResultDesc: 'Success'
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      } catch (error) {
        console.error('❌ Callback error:', error);
        return new Response(JSON.stringify({
          ResultCode: 1,
          ResultDesc: 'Error processing callback'
        }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // ── CHECK PAYMENT STATUS ──
    if (url.pathname.startsWith('/api/payment/status/') && request.method === 'GET') {
      try {
        const checkoutId = url.pathname.split('/').pop();

        if (!checkoutId) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Checkout ID is required'
          }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }

        console.log(`🔍 Checking status for: ${checkoutId}`);

        const response = await fetch(`${MEGAPAY_BASE_URL}/stk/status/${checkoutId}`, {
          headers: {
            'X-API-Key': MEGAPAY_API_KEY,
            'X-API-Secret': MEGAPAY_API_SECRET
          }
        });

        const data = await response.json();
        console.log('📨 Status Response:', data);

        return new Response(JSON.stringify({
          success: true,
          checkoutId: checkoutId,
          status: data.status || data.ResultCode || 'pending',
          data: data
        }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      } catch (error) {
        console.error('❌ Status check error:', error);
        return new Response(JSON.stringify({
          success: false,
          error: error.message || 'Status check failed'
        }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }

    // ── API DOCUMENTATION ──
    if (url.pathname === '/api') {
      return new Response(JSON.stringify({
        name: 'KenyaVault Payment API',
        version: '1.0.0',
        endpoints: {
          'POST /api/payment/initiate': {
            description: 'Initiate M-PESA STK Push payment',
            body: {
              phoneNumber: '0712345678',
              amount: 100,
              resourceId: '123',
              resourceTitle: 'Biology Notes'
            }
          },
          'GET /api/payment/status/:checkoutId': {
            description: 'Check payment status'
          },
          'POST /api/payment/callback': {
            description: 'Megapay callback endpoint (webhook)'
          }
        }
      }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    // ── NOT FOUND ──
    return new Response(JSON.stringify({
      error: 'Endpoint not found',
      available: ['/api', '/api/payment/initiate', '/api/payment/status/:id']
    }), { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
};
// index.js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // ── API ROUTES ──
    if (url.pathname === '/api/payment/initiate' && request.method === 'POST') {
      // Even without env variables, you can still use hardcoded or the env param
      const apiKey = env.MEGAPAY_API_KEY || 'MGPYDSg2lIYA';
      const paybill = env.MEGAPAY_PAYBILL || '522522';
      
      // Your payment logic here
      // ...
    }
    
    if (url.pathname === '/api/payment/callback' && request.method === 'POST') {
      // Handle callback
      // ...
    }
    
    // ── STATIC ASSETS ──
    // Since you have static assets, Cloudflare automatically serves them
    // Just return a 404 for unmatched routes
    return new Response('Page not found', { status: 404 });
  }
};
