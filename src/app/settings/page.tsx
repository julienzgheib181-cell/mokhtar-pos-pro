export default function Settings() {
  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card">
        <div className="hd">Settings</div>
        <div className="bd">
          <div className="muted" style={{fontWeight:700}}>
            - Add your `.env.local` for Supabase + Firebase<br/>
            - Deploy on Vercel + add Environment Variables<br/>
            - Later: enable push notifications + WhatsApp quick message templates
          </div>
        </div>
      </div>
    </div>
  );
}
