// supabase/functions/migrate-resources/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  try {
    // Get all paid resources
    const { data: resources, error: fetchError } = await supabase
      .from('resources')
      .select('*')
      .eq('is_free', false)
      .gt('price', 0)
      .neq('bucket', 'private-resources')

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log(`📋 Found ${resources.length} resources to migrate`)

    let migrated = 0
    let failed = 0

    for (const resource of resources) {
      try {
        // Get file path
        let filePath = resource.file_path
        if (!filePath && resource.file_url) {
          const match = resource.file_url.match(/\/public\/(?:kenyavault-resources)\/(.+)$/)
          if (match) filePath = match[1]
        }

        if (!filePath) {
          console.log(`❌ No file path for ${resource.id}`)
          failed++
          continue
        }

        // Download from public bucket
        const publicUrl = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/kenyavault-resources/${filePath}`
        const fileResponse = await fetch(publicUrl)

        if (!fileResponse.ok) {
          console.log(`❌ Failed to download ${filePath}`)
          failed++
          continue
        }

        const fileBlob = await fileResponse.blob()
        const fileName = filePath.split('/').pop() || 'file.pdf'
        const newPath = `resources/${resource.id}/${Date.now()}_${fileName}`

        // Upload to private bucket
        const { error: uploadError } = await supabase
          .storage
          .from('private-resources')
          .upload(newPath, fileBlob, {
            contentType: fileBlob.type || 'application/octet-stream',
            metadata: {
              resource_id: resource.id,
              original_name: fileName
            }
          })

        if (uploadError) {
          console.log(`❌ Upload failed for ${resource.id}:`, uploadError)
          failed++
          continue
        }

        // Update resource
        const { error: updateError } = await supabase
          .from('resources')
          .update({
            bucket: 'private-resources',
            file_path: newPath,
            file_url: `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/private-resources/${newPath}`,
            storage_path: newPath,
            updated_at: new Date().toISOString()
          })
          .eq('id', resource.id)

        if (updateError) {
          console.log(`❌ Update failed for ${resource.id}:`, updateError)
          failed++
          continue
        }

        console.log(`✅ Migrated: ${resource.title}`)
        migrated++
      } catch (error) {
        console.log(`❌ Error: ${resource.id}`, error.message)
        failed++
      }
    }

    return new Response(
      JSON.stringify({
        message: 'Migration complete',
        migrated,
        failed,
        total: resources.length
      }),
      { 
        status: 200, 
        headers: { 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
