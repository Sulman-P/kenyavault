// supabase/functions/get-secure-download/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { resource_id, order_ref, customer_phone } = await req.json()
    
    if (!resource_id || !order_ref) {
      return new Response(
        JSON.stringify({ error: 'Resource ID and Order Reference required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify the user has purchased this resource
    // Using customer_phone as identifier since that's what's available
    let query = supabase
      .from('orders')
      .select('*')
      .eq('resource_id', resource_id)
      .eq('order_ref', order_ref)
      .eq('payment_confirmed', true)
    
    if (customer_phone) {
      query = query.eq('customer_phone', customer_phone)
    }

    const { data: order, error } = await query.single()

    if (error || !order) {
      console.error('Order verification failed:', error)
      return new Response(
        JSON.stringify({ error: 'Unauthorized - No valid purchase found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the file path from the resource
    const { data: resource, error: resourceError } = await supabase
      .from('resources')
      .select('file_path, file_name, file_url')
      .eq('id', resource_id)
      .single()

    if (resourceError || !resource) {
      console.error('Resource not found:', resourceError)
      return new Response(
        JSON.stringify({ error: 'Resource not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine the file path
    let filePath = resource.file_path
    if (!filePath) {
      // If no file_path, construct it from the file_url
      const urlParts = resource.file_url?.split('/') || []
      const bucketIndex = urlParts.indexOf('private-resources')
      if (bucketIndex !== -1 && bucketIndex + 1 < urlParts.length) {
        filePath = urlParts.slice(bucketIndex + 1).join('/')
      } else {
        filePath = `resources/${resource_id}/${resource.file_name || 'file.pdf'}`
      }
    }

    // Generate a signed URL (valid for 60 seconds)
    const { data: signedUrl, error: urlError } = await supabase
      .storage
      .from('private-resources')
      .createSignedUrl(filePath, 60)

    if (urlError) {
      console.error('Signed URL generation failed:', urlError)
      return new Response(
        JSON.stringify({ error: 'Failed to generate download URL: ' + urlError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Record download (increment download count)
    try {
      const { data: currentResource } = await supabase
        .from('resources')
        .select('download_count')
        .eq('id', resource_id)
        .single()
      
      if (currentResource) {
        const newCount = (currentResource.download_count || 0) + 1
        await supabase
          .from('resources')
          .update({ download_count: newCount })
          .eq('id', resource_id)
      }
    } catch (e) {
      console.warn('Failed to update download count:', e)
    }

    return new Response(
      JSON.stringify({ 
        url: signedUrl.signedUrl,
        expires_in: 60,
        file_name: resource.file_name
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error: ' + error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
