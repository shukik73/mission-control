# Mission Control Setup Guide

## 1. Supabase Setup

1. Create new Supabase project at https://supabase.com
2. Go to SQL Editor
3. Paste contents of `01_mission_control_schema.sql`
4. Execute the migration
5. Copy your project URL and service role key
6. **Important:** Enable Realtime for the `missions` table:
   - Go to Database → Replication
   - Toggle on `missions` table for INSERT events

## 2. Telegram Bot Setup

1. Message @BotFather on Telegram
2. Send `/newbot`
3. Follow prompts to name your bot
4. Copy the bot token
5. Get your Telegram user ID:
   - Message @userinfobot
   - Copy your numeric ID

## 3. Install & Run Bot

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
npm start
```

## 4. Test the Bot

1. Find your bot on Telegram
2. Send `/start`
3. Try `/status` to see mission control
4. **Note:** Only the Telegram user matching `SHUKI_TELEGRAM_ID` can use the bot. All others are blocked.

## 5. Deploy (Optional)

### PM2 (Recommended for VPS)

```bash
npm install -g pm2
pm2 start telegram-bot.js --name mission-control
pm2 save
pm2 startup
```

### Docker

```bash
docker build -t mission-control-bot .
docker run -d --env-file .env mission-control-bot
```

## 6. Connect Scout Agent

Scout should insert deals into the database:

```javascript
await supabase.from('missions').insert({
  agent_id: 'scout',
  status: 'needs_shuki',
  priority: 'urgent',
  title: 'MacBook Pro A1502 Logic Board',
  assigned_to: 'shuki',
  deadline: new Date(Date.now() + 2*60*60*1000), // 2 hours
  metadata: {
    deal_id: 'scout-001',
    ebay_url: 'https://ebay.com/itm/123456',
    price: 89,
    estimated_value: 180,
    roi_percent: 102
  }
});
```

Telegram will instantly notify you with approve/reject buttons!

## 7. Priority Sort Order

The schema uses a Postgres ENUM for priorities, which sorts in definition order:
`urgent` → `high` → `normal` → `low`

This means `ORDER BY priority ASC` correctly shows urgent items first.
