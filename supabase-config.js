/* ═══════════════════════════════════════════
   KENYAVAULT — SHARED SUPABASE CONFIG
   Loaded by every public page (shop, classes, etc.)
   ═══════════════════════════════════════════ */

// ⚠️ REPLACE THESE WITH YOUR REAL SUPABASE VALUES
// Get them from: Supabase Dashboard → Settings → API
const KV_SUPABASE_URL = 'https://rewpminmqnrtwdvglxxr.supabase.co';
const KV_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJld3BtaW5tcW5ydHdkdmdseHhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NDkzOTksImV4cCI6MjA5NzMyNTM5OX0.2HnM4NMvxOlqrc2ChuFa_F6kqEniSah3NU5vTLNtfYs';

let kvClient = null;

function kvInit() {
  if (kvClient) return kvClient;
  if (typeof window.supabase === 'undefined') {
    console.error('Supabase library not loaded. Check the <script> tag order.');
    return null;
  }
  if (KV_SUPABASE_URL.includes('YOUR_PROJECT_REF') || KV_SUPABASE_ANON_KEY.includes('YOUR_ANON')) {
    console.warn('KenyaVault: Supabase credentials not set in supabase-config.js — public pages will show empty state.');
    return null;
  }
  kvClient = window.supabase.createClient(KV_SUPABASE_URL, KV_SUPABASE_ANON_KEY);
  return kvClient;
}

/* ── FETCH HELPERS used by shop.html, classes.html, product.html ── */

async function kvFetchResources(filters = {}) {
  const client = kvInit();
  if (!client) return [];
  let q = client.from('resources').select('*').eq('published', true);
  if (filters.level)   q = q.eq('level', filters.level);
  if (filters.subject) q = q.eq('subject', filters.subject);
  q = q.order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) { console.error('kvFetchResources error:', error); return []; }
  return data || [];
}

async function kvFetchResourceById(id) {
  const client = kvInit();
  if (!client) return null;
  const { data, error } = await client.from('resources').select('*').eq('id', id).single();
  if (error) { console.error('kvFetchResourceById error:', error); return null; }
  return data;
}

async function kvFetchClasses(filters = {}) {
  const client = kvInit();
  if (!client) return [];
  let q = client.from('classes').select('*').neq('status', 'cancelled');
  if (filters.level) q = q.eq('level', filters.level);
  q = q.order('date', { ascending: true });
  const { data, error } = await q;
  if (error) { console.error('kvFetchClasses error:', error); return []; }
  return data || [];
}

async function kvFetchTutors() {
  const client = kvInit();
  if (!client) return [];
  const { data, error } = await client.from('tutors').select('*').order('created_at', { ascending: false });
  if (error) { console.error('kvFetchTutors error:', error); return []; }
  return data || [];
}

/* ── ORDER / BOOKING CREATION (called when a student confirms payment) ── */

async function kvCreateOrder(order) {
  const client = kvInit();
  if (!client) return { error: 'Supabase not connected' };
  const ref = 'KV-' + Date.now().toString().slice(-8);
  const { data, error } = await client.from('orders').insert([{ ...order, ref, status: 'pending' }]).select().single();
  return { data, error };
}

async function kvCreateBooking(booking) {
  const client = kvInit();
  if (!client) return { error: 'Supabase not connected' };
  const { data, error } = await client.from('bookings').insert([{ ...booking, status: 'pending' }]).select().single();
  return { data, error };
}

/* ── UI HELPERS ── */

const KV_LEVEL_BADGE_CLASS = { kjsea: 'purple', junior: 'blue', senior: 'green', '844': 'yellow' };
const KV_LEVEL_LABEL = { kjsea: 'KJSEA 2025', junior: 'Junior School', senior: 'Senior School', '844': '8-4-4' };

const KV_SUBJECT_BG = {
  mathematics:'math-bg', english:'eng-bg', kiswahili:'kisw-bg', 'integrated-science':'sci-bg',
  'pre-technical':'tech-bg', 'social-studies':'soc-bg', 'religious-education':'re-bg',
  'creative-arts':'art-bg', agriculture:'agri-bg', 'health-pe':'pe-bg',
  biology:'bio-bg', chemistry:'chem-bg', physics:'phys-bg',
  'core-mathematics':'math-bg', 'essential-mathematics':'math-bg', geography:'geo-bg',
  history:'hist-bg', literature:'eng-bg', business:'bus-bg', 'computer-studies':'comp-bg', 'home-science':'home-bg'
};
const KV_SUBJECT_TEXT = {
  mathematics:'math-text', english:'eng-text', kiswahili:'kisw-text', 'integrated-science':'sci-text',
  'pre-technical':'tech-text', 'social-studies':'soc-text', 'religious-education':'re-text',
  'creative-arts':'art-text', agriculture:'agri-text', 'health-pe':'pe-text',
  biology:'bio-text', chemistry:'chem-text', physics:'phys-text',
  'core-mathematics':'math-text', 'essential-mathematics':'math-text', geography:'geo-text',
  history:'hist-text', literature:'eng-text', business:'bus-text', 'computer-studies':'comp-text', 'home-science':'home-text'
};

function kvSubjectBg(subject)   { return KV_SUBJECT_BG[subject]   || 'sci-bg'; }
function kvSubjectText(subject) { return KV_SUBJECT_TEXT[subject] || 'sci-text'; }
function kvSubjectLabel(subject) {
  if (!subject) return '';
  return subject.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
function kvBadgeLabel(badge) {
  const map = { new:'🆕 New', popular:'⭐ Popular', hot:'🔥 Hot', exam:'📝 Exam Prep', bundle:'📦 Bundle', kjsea:'🏆 KJSEA' };
  return map[badge] || '🆕 New';
}
function kvBadgeClass(badge) {
  const map = { new:'badge-new', popular:'badge-popular', hot:'badge-hot', exam:'badge-exam', bundle:'badge-bundle', kjsea:'badge-kjsea' };
  return map[badge] || 'badge-new';
}
