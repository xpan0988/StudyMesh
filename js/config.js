// Config and shared constants
const SUPABASE_URL = "https://hggtasggdhdgiyhatgfu.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_2n13yzDWTemoCgKeLxAZWw_cHkkG4ke";

    const supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );

    async function initSupabase() {
      return supabaseClient;
    }

    const DEBUG_LOGS = false;
    const DEBUG_AUTH_LOGS = false;
    const DEBUG_POLLING_LOGS = false;
    const DEBUG_E2EE_LOGS = false;

    function debugLog(enabled, ...args) {
      if (!enabled) return;
      console.log(...args);
    }

    const FILE_LIBRARY = [
      { name: 'interview_notes.pdf', icon: '📄', type: 'PDF' },
      { name: 'wireframe_v3.fig', icon: '🎨', type: 'FIG' },
      { name: 'usability_findings.docx', icon: '📝', type: 'DOCX' },
      { name: 'survey_results.xlsx', icon: '📋', type: 'XLSX' },
      { name: 'meeting_summary.txt', icon: '📃', type: 'TXT' },
      { name: 'persona_board.png', icon: '🖼️', type: 'PNG' },
    ];

    const SCHEDULE_DAYS = [
      { weekday: 1, label: 'Monday', shortDate: 'Day 1' },
      { weekday: 2, label: 'Tuesday', shortDate: 'Day 2' },
      { weekday: 3, label: 'Wednesday', shortDate: 'Day 3' },
      { weekday: 4, label: 'Thursday', shortDate: 'Day 4' },
      { weekday: 5, label: 'Friday', shortDate: 'Day 5' },
      { weekday: 6, label: 'Saturday', shortDate: 'Day 6' },
      { weekday: 7, label: 'Sunday', shortDate: 'Day 7' },
    ];

    const SCHEDULE_START_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

    const SCHEDULE_SECTIONS = [
      { key: 'morning', label: 'Morning', hours: [8, 10] },
      { key: 'afternoon', label: 'Afternoon', hours: [12, 14, 16] },
      { key: 'evening', label: 'Evening', hours: [18, 20, 22] },
    ];
