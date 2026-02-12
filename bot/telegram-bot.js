require('dotenv').config();

const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SHUKI_TELEGRAM_ID = process.env.SHUKI_TELEGRAM_ID;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !SHUKI_TELEGRAM_ID) {
  console.error('Missing required environment variables. Check your .env file.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================
// AUTH MIDDLEWARE — only Shuki can use the bot
// ============================================
bot.use((ctx, next) => {
  if (String(ctx.from?.id) !== SHUKI_TELEGRAM_ID) {
    return ctx.reply('⛔ Unauthorized. This bot is private.');
  }
  return next();
});

// ============================================
// COMMANDS
// ============================================

bot.command('start', (ctx) => {
  ctx.reply(`
🤖 *Mission Control Bot Active*

Available commands:
/status - Mission Control summary
/inbox - Show pending approvals
/urgent - Show only urgent items
/agent [name] - Agent status
/approve [id] - Approve deal/task
/reject [id] [reason] - Reject with reason
/help - Show this message
  `, { parse_mode: 'Markdown' });
});

bot.command('status', async (ctx) => {
  try {
    const { data: summary } = await supabase
      .from('mission_control_summary')
      .select('*');

    const { data: agents } = await supabase
      .from('agent_performance_today')
      .select('*');

    const { data: financials } = await supabase
      .from('financial_tracking')
      .select('revenue, cost')
      .eq('date', new Date().toISOString().split('T')[0]);

    const totalRevenue = financials?.reduce((sum, f) => sum + parseFloat(f.revenue || 0), 0) || 0;
    const totalCost = financials?.reduce((sum, f) => sum + parseFloat(f.cost || 0), 0) || 0;

    let message = `📊 *Mission Control Status*\n\n`;
    message += `💰 Today's Revenue: $${totalRevenue.toFixed(2)}\n`;
    message += `💸 Today's Cost: $${totalCost.toFixed(2)}\n`;
    message += `📈 Net Profit: $${(totalRevenue - totalCost).toFixed(2)}\n\n`;

    message += `*Task Pipeline:*\n`;
    summary?.forEach(s => {
      const emoji = s.status === 'needs_shuki' ? '🔴' :
                    s.status === 'inbox' ? '📥' :
                    s.status === 'active' ? '⚡' : '📋';
      message += `${emoji} ${s.status.toUpperCase()}: ${s.count}`;
      if (s.urgent_count > 0) message += ` (${s.urgent_count} urgent)`;
      message += `\n`;
    });

    message += `\n*Agents:*\n`;
    agents?.forEach(a => {
      const statusEmoji = a.status === 'active' ? '🟢' :
                          a.status === 'error' ? '🔴' : '⚪';
      message += `${statusEmoji} ${a.name}: ${a.tasks_completed_today} done, ${a.tasks_pending} pending\n`;
    });

    ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply('❌ Error fetching status: ' + error.message);
  }
});

bot.command('inbox', async (ctx) => {
  try {
    const { data: missions } = await supabase
      .from('missions')
      .select('*')
      .in('status', ['inbox', 'needs_shuki'])
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(10);

    if (!missions || missions.length === 0) {
      return ctx.reply('✅ Inbox is empty!');
    }

    for (const mission of missions) {
      const priorityEmoji = mission.priority === 'urgent' ? '🔴' :
                            mission.priority === 'high' ? '🟡' : '⚪';

      let message = `${priorityEmoji} *${mission.title}*\n`;
      message += `Agent: ${mission.agent_id}\n`;
      message += `Status: ${mission.status}\n`;

      if (mission.deadline) {
        const hoursLeft = Math.floor((new Date(mission.deadline) - new Date()) / (1000 * 60 * 60));
        message += `⏰ Deadline: ${hoursLeft}h remaining\n`;
      }

      if (mission.metadata) {
        if (mission.metadata.roi_percent) {
          message += `\n💰 Price: $${mission.metadata.price}\n`;
          message += `📊 Est. Value: $${mission.metadata.estimated_value}\n`;
          message += `🎯 ROI: ${mission.metadata.roi_percent}%\n`;
          if (mission.metadata.is_local_pickup) message += `📍 Local pickup\n`;
          if (mission.metadata.ebay_url) message += `🔗 ${mission.metadata.ebay_url}\n`;
        }
      }

      ctx.reply(message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Approve', callback_data: `approve_${mission.id}` },
            { text: '❌ Reject', callback_data: `reject_${mission.id}` },
            { text: '💬 Ask Jay', callback_data: `askjay_${mission.id}` }
          ]]
        }
      });
    }
  } catch (error) {
    ctx.reply('❌ Error: ' + error.message);
  }
});

bot.command('urgent', async (ctx) => {
  try {
    const { data: missions } = await supabase
      .from('missions')
      .select('*')
      .eq('priority', 'urgent')
      .neq('status', 'done')
      .order('created_at', { ascending: true });

    if (!missions || missions.length === 0) {
      return ctx.reply('✅ No urgent tasks!');
    }

    let message = `🔴 *URGENT TASKS (${missions.length})*\n\n`;
    missions.forEach((m, i) => {
      message += `${i+1}. ${m.title} (${m.agent_id})\n`;
      message += `   ID: \`${m.id}\`\n`;
    });

    ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    ctx.reply('❌ Error: ' + error.message);
  }
});

// ============================================
// INLINE BUTTON CALLBACKS
// ============================================

bot.action(/approve_(.+)/, async (ctx) => {
  const missionId = ctx.match[1];

  try {
    // Fetch mission first to verify state and get details
    const { data: mission, error: fetchError } = await supabase
      .from('missions')
      .select('*')
      .eq('id', missionId)
      .single();

    if (fetchError) throw fetchError;
    if (!mission) throw new Error('Mission not found');

    // Guard: only approve if still in an actionable state
    if (mission.status === 'done' || mission.status === 'rejected') {
      await ctx.answerCbQuery('Already actioned');
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      return;
    }

    // Update mission status
    const { error: missionError } = await supabase
      .from('missions')
      .update({
        status: 'assigned',
        assigned_to: 'jay',
        updated_at: new Date().toISOString()
      })
      .eq('id', missionId);

    if (missionError) throw missionError;

    // If it's a Scout deal, update scout_deals table (only if still pending)
    if (mission.agent_id === 'scout') {
      const { data: deal } = await supabase
        .from('scout_deals')
        .update({
          status: 'approved',
          decision_made_at: new Date().toISOString()
        })
        .eq('mission_id', missionId)
        .eq('status', 'pending')
        .select('id')
        .single();

      // Audit log for deal approval
      if (deal) {
        await supabase.from('deal_audit_log').insert({
          deal_id: deal.id,
          mission_id: missionId,
          action: 'approved',
          source: 'telegram',
          performed_by: 'shuki',
        });
      }
    }

    // Log activity
    await supabase
      .from('agent_activity')
      .insert({
        agent_id: 'jay',
        activity_type: 'mission_approved',
        mission_id: missionId,
        message: `Shuki approved mission: ${mission.title}`,
        severity: 'info'
      });

    await ctx.answerCbQuery('✅ Approved! Jay will execute.');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(`✅ Mission approved and assigned to Jay for execution.`);

  } catch (error) {
    await ctx.answerCbQuery('❌ Error: ' + error.message);
  }
});

bot.action(/reject_(.+)/, async (ctx) => {
  const missionId = ctx.match[1];

  await ctx.answerCbQuery();
  await ctx.reply(`Please provide rejection reason:\n\n/reject ${missionId} [your reason]`);
});

bot.action(/askjay_(.+)/, async (ctx) => {
  const missionId = ctx.match[1];

  try {
    const { data: mission } = await supabase
      .from('missions')
      .select('*')
      .eq('id', missionId)
      .single();

    if (!mission) throw new Error('Mission not found');

    // Create a sub-mission for Jay to review and advise
    const { error } = await supabase
      .from('missions')
      .insert({
        agent_id: 'jay',
        status: 'assigned',
        priority: mission.priority,
        title: `Review & Advise: ${mission.title}`,
        description: `Shuki wants your analysis on mission ${missionId}. Original: ${mission.description || mission.title}`,
        assigned_to: 'jay',
        metadata: {
          parent_mission_id: missionId,
          review_type: 'shuki_asked_jay',
          original_metadata: mission.metadata
        }
      });

    if (error) throw error;

    // Log the activity
    await supabase
      .from('agent_activity')
      .insert({
        agent_id: 'jay',
        activity_type: 'review_requested',
        mission_id: missionId,
        message: `Shuki requested Jay's analysis on: ${mission.title}`,
        severity: 'info'
      });

    await ctx.answerCbQuery('💬 Jay will review this.');
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.reply(`💬 Jay has been asked to review this mission and will report back.`);
  } catch (error) {
    await ctx.answerCbQuery('❌ Error: ' + error.message);
  }
});

bot.command('reject', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const missionId = args[0];
  const reason = args.slice(1).join(' ') || 'No reason provided';

  if (!missionId) {
    return ctx.reply('Usage: /reject [mission-id] [reason]');
  }

  try {
    // Fetch mission status and metadata
    const { data: mission, error: fetchError } = await supabase
      .from('missions')
      .select('status, metadata')
      .eq('id', missionId)
      .single();

    if (fetchError) throw fetchError;
    if (!mission) throw new Error('Mission not found');

    // Guard: only reject if still in an actionable state
    if (mission.status === 'done' || mission.status === 'rejected') {
      return ctx.reply('This mission has already been actioned.');
    }

    // Merge rejection reason into existing metadata
    const updatedMetadata = { ...(mission.metadata || {}), rejection_reason: reason };

    const { error } = await supabase
      .from('missions')
      .update({
        status: 'rejected',
        completed_at: new Date().toISOString(),
        metadata: updatedMetadata
      })
      .eq('id', missionId);

    if (error) throw error;

    // Update scout_deals if applicable (only if still pending)
    const { data: deal } = await supabase
      .from('scout_deals')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        decision_made_at: new Date().toISOString()
      })
      .eq('mission_id', missionId)
      .eq('status', 'pending')
      .select('id')
      .single();

    // Audit log for deal rejection
    if (deal) {
      await supabase.from('deal_audit_log').insert({
        deal_id: deal.id,
        mission_id: missionId,
        action: 'rejected',
        source: 'telegram',
        reason: reason,
        performed_by: 'shuki',
      });
    }

    await supabase
      .from('agent_activity')
      .insert({
        agent_id: 'scout',
        activity_type: 'mission_rejected',
        mission_id: missionId,
        message: `Mission rejected: ${reason}`,
        severity: 'warning'
      });

    ctx.reply(`❌ Mission rejected.\nReason: ${reason}\n\nScout will learn from this.`);
  } catch (error) {
    ctx.reply('❌ Error: ' + error.message);
  }
});

// ============================================
// REAL-TIME NOTIFICATIONS
// ============================================

async function startNotificationService() {
  const channel = supabase
    .channel('mission-alerts')
    .on('postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'missions',
        filter: 'assigned_to=eq.shuki'
      },
      async (payload) => {
        const mission = payload.new;

        const priorityEmoji = mission.priority === 'urgent' ? '🔴' :
                              mission.priority === 'high' ? '🟡' : '⚪';

        let message = `${priorityEmoji} *New Task Requires Approval*\n\n`;
        message += `${mission.title}\n`;
        message += `Agent: ${mission.agent_id}\n`;

        if (mission.metadata?.roi_percent) {
          message += `\n💰 Price: $${mission.metadata.price}\n`;
          message += `📊 ROI: ${mission.metadata.roi_percent}%\n`;
          message += `🎯 Profit: $${mission.metadata.estimated_value - mission.metadata.price}\n`;
        }

        try {
          await bot.telegram.sendMessage(SHUKI_TELEGRAM_ID, message, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ Approve', callback_data: `approve_${mission.id}` },
                { text: '❌ Reject', callback_data: `reject_${mission.id}` }
              ]]
            }
          });
        } catch (err) {
          console.error('Failed to send Telegram notification:', err.message);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime subscription active — listening for missions assigned to Shuki');
      } else {
        console.error('⚠️ Realtime subscription status:', status);
      }
    });
}

// ============================================
// LAUNCH
// ============================================

bot.launch().then(() => {
  console.log('🤖 Mission Control Bot is running...');
  startNotificationService();
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
