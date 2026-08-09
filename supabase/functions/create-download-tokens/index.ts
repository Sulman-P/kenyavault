// supabase/functions/create-download-tokens/index.ts
//
// Mints download tokens for a paid order (or a set of order ids that
// share an order_ref, e.g. a multi-item cart checkout).
//
// SECURITY:
// - Runs with the service role key (server-side only, never exposed
//   to the browser). This is the ONLY place download_tokens rows
//   are created.
// - A token is only ever issued for an order whose payment_status is
//   'paid' / 'completed' (or a genuinely free item). Pending,
//   underpaid, cancelled, or failed orders never get a token.
//
// Required secrets (set via `supabase secrets set`):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { order_ref, order_ids } = await req.json();
    if (!order_ref && (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0)) {
      return json({ error: "order_ref or order_ids is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("rewpminmqnrtwdvglxxr.supabase.co")!,
      Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc0OTM5OSwiZXhwIjoyMDk3MzI1Mzk5fQ.qkL7O1o1dhf9jCFuIQIUyJWFUBaq404ePWU0X4I5p1k")!,
    );

    let query = supabase
      .from("orders")
      .select("id, order_ref, resource_id, item_title, resource_file_path, resource_file_name, payment_status, total_amount, amount_paid");

    if (order_ids && order_ids.length > 0) {
      query = query.in("id", order_ids);
    } else {
      query = query.eq("order_ref", order_ref);
    }

    const { data: orders, error: ordersErr } = await query;
    if (ordersErr) {
      console.error(ordersErr);
      return json({ error: "Failed to load order" }, 500);
    }
    if (!orders || orders.length === 0) {
      return json({ error: "Order not found" }, 404);
    }

    // If an order_ref was supplied, make sure every row genuinely
    // belongs to it (defends against a caller trying to mix in an
    // unrelated order id under the same request).
    if (order_ref && orders.some((o) => o.order_ref !== order_ref)) {
      return json({ error: "Order reference mismatch" }, 403);
    }

    const issued: Array<Record<string, unknown>> = [];

    for (const order of orders) {
      const isPaid = order.payment_status === "paid" || order.payment_status === "completed";
      const isFree = order.total_amount === 0 || order.total_amount === null || order.total_amount === undefined;

      if (!isPaid && !isFree) {
        // pending / underpaid / cancelled / failed -> no token, silently skip
        continue;
      }
      if (!order.resource_id) continue;

      // Cryptographically random token — never derived from
      // resource id / order id / timestamp / phone / email.
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hour window

      const { data: inserted, error: insErr } = await supabase
        .from("download_tokens")
        .insert({
          token,
          order_id: order.id,
          resource_id: order.resource_id,
          order_ref: order.order_ref,
          status: "active",
          expires_at: expiresAt,
        })
        .select()
        .single();

      if (insErr) {
        console.error("Failed to insert token for order", order.id, insErr);
        continue;
      }

      issued.push({
        order_id: order.id,
        resource_id: order.resource_id,
        title: order.item_title,
        file_name: order.resource_file_name,
        token: inserted.token,
        expires_at: inserted.expires_at,
      });
    }

    if (issued.length === 0) {
      return json({ error: "No paid resources are available for download on this order" }, 403);
    }

    return json({ tokens: issued });
  } catch (e) {
    console.error(e);
    return json({ error: "Internal error" }, 500);
  }
});
