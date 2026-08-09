// supabase/functions/secure-download/index.ts
//
// Validates a download token and, only if everything checks out,
// returns a short-lived SIGNED url (never a permanent public url)
// for a paid resource.
//
// Checks performed (in order), any failure -> 403/404, no url leaked:
//   1. token exists
//   2. token status is 'active'
//   3. token has not expired
//   4. order exists
//   5. order is paid (or genuinely free)
//   6. the token's resource_id actually matches the order's resource_id
//      (blocks someone swapping resource_id in the request)
//   7. the file can be located in storage
//
// Required secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Update this list if your storage bucket names differ.
const BUCKETS = ["kenyavault-resources", "kenyavault-pdfs", "academic-resources"];

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
    const { order_id, resource_id, token } = await req.json();
    if (!order_id || !resource_id || !token) {
      return json({ error: "order_id, resource_id and token are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("rewpminmqnrtwdvglxxr.supabase.co")!,
      Deno.env.get("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTc0OTM5OSwiZXhwIjoyMDk3MzI1Mzk5fQ.qkL7O1o1dhf9jCFuIQIUyJWFUBaq404ePWU0X4I5p1k")!,
    );

    // 1-3: token lookup + status + expiry
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("download_tokens")
      .select("*")
      .eq("token", token)
      .eq("order_id", order_id)
      .eq("resource_id", resource_id)
      .maybeSingle();

    if (tokenErr) {
      console.error(tokenErr);
      return json({ error: "Lookup failed" }, 500);
    }
    if (!tokenRow) {
      return json({ error: "Invalid download token" }, 403);
    }
    if (tokenRow.status !== "active") {
      return json({ error: "Download token is no longer valid" }, 403);
    }
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return json({ error: "Download link expired" }, 403);
    }

    // 4-6: order verification
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, resource_id, payment_status, total_amount, amount_paid, resource_file_path, resource_file_name")
      .eq("id", order_id)
      .maybeSingle();

    if (orderErr || !order) return json({ error: "Order not found" }, 404);

    const isPaid = order.payment_status === "paid" || order.payment_status === "completed";
    const isFree = order.total_amount === 0 || order.total_amount === null || order.total_amount === undefined;
    if (!isPaid && !isFree) {
      return json({ error: "Payment not confirmed for this order" }, 403);
    }

    if (String(order.resource_id) !== String(resource_id)) {
      // The resource on the token/request does not match what was
      // actually purchased on this order -> block it outright.
      return json({ error: "This resource was not purchased on this order" }, 403);
    }

    // 7: locate + sign the file
    let filePath = order.resource_file_path as string | null;
    if (!filePath) {
      const { data: resource } = await supabase
        .from("resources")
        .select("file_path, file_url")
        .eq("id", resource_id)
        .maybeSingle();
      filePath = resource?.file_path || resource?.file_url || null;
    }
    if (!filePath) return json({ error: "Resource file not found" }, 404);

    filePath = filePath.replace(/^https?:\/\/[^/]+\/storage\/v1\/object\/(public|sign)\/[^/]+\//, "");
    filePath = filePath.replace(/^\/+/, "");

    let signedUrl: string | null = null;
    outer: for (const bucket of BUCKETS) {
      const candidates = [filePath, filePath.replace(/^resources\//, ""), `resources/${filePath}`];
      for (const path of candidates) {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300); // 5 min
        if (!error && data?.signedUrl) {
          signedUrl = data.signedUrl;
          break outer;
        }
      }
    }

    if (!signedUrl) return json({ error: "File could not be located in storage" }, 404);

    // Record usage (token stays valid until it expires — customers
    // can re-download within the window without regenerating).
    await supabase
      .from("download_tokens")
      .update({
        last_used_at: new Date().toISOString(),
        used_at: tokenRow.used_at || new Date().toISOString(),
        use_count: (tokenRow.use_count || 0) + 1,
      })
      .eq("id", tokenRow.id);

    return json({
      download_url: signedUrl,
      file_name: order.resource_file_name || filePath.split("/").pop(),
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Internal error" }, 500);
  }
});
