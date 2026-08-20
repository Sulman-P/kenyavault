// worker.js - Cloudflare Worker version
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Handle API requests
    if (url.pathname === '/api/mpesa/stk-push') {
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      try {
        const body = await request.json();
        const { phone, amount, order_id } = body;

        // Validate
        if (!phone || !amount || !order_id) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Missing required fields'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Your MegaPay API call here
        const megaPayResponse = await fetch('https://megapay.co.ke/backend/initiatestk', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: 'MGPYDSg2lIYA',
            phone: phone.replace(/\D/g, ''),
            amount: amount,
            reference: `KV-${Date.now()}`,
            callback: 'https://kenyavault.co.ke/api/mpesa/callback',
            description: `Payment for order ${order_id}`
          })
        });

        const result = await megaPayResponse.json();

        return new Response(JSON.stringify({
          success: true,
          data: result
        }), {
          headers: { 'Content-Type': 'application/json' }
        });

      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Handle health check
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Default response
    return new Response('KenyaVault API', {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};
