import { supabase } from './supabase';
import { getSupabaseOrderColumns, getSupabaseProjection } from './supabaseProjections';
import { fetchAllSupabaseRows } from './supabaseCompleteRead';

export interface ChatPin {
    id: string;
    conversationId: string;
    messageId: string;
    pinnedBy: string;
    pinnedAt: string;
}

export async function pinMessage(conversationId: string, messageId: string, pinnedBy: string): Promise<ChatPin> {
    const { data, error } = await supabase
        .from('chat_pins')
        .insert({
            conversation_id: conversationId,
            message_id: messageId,
            pinned_by: pinnedBy,
        })
        .select()
        .single();

    if (error) {
        throw error;
    }

    return {
        id: data.id,
        conversationId: data.conversation_id,
        messageId: data.message_id,
        pinnedBy: data.pinned_by,
        pinnedAt: data.pinned_at,
    };
}

export async function unpinMessage(conversationId: string, messageId: string): Promise<void> {
    const { error } = await supabase
        .from('chat_pins')
        .delete()
        .eq('conversation_id', conversationId)
        .eq('message_id', messageId);

    if (error) {
        throw error;
    }
}

export async function getPinnedMessages(conversationId: string): Promise<ChatPin[]> {
    const { data, error } = await fetchAllSupabaseRows(supabase
        .from('chat_pins')
        .select(getSupabaseProjection('chat_pins'))
        .eq('conversation_id', conversationId)
        .order('pinned_at', { ascending: false }), { label: "lib/chatPinService.ts:49", maxRows: 20_000, orderBy: getSupabaseOrderColumns('chat_pins') });

    if (error) {
        throw error;
    }

    return (data || []).map(d => ({
        id: d.id,
        conversationId: d.conversation_id,
        messageId: d.message_id,
        pinnedBy: d.pinned_by,
        pinnedAt: d.pinned_at,
    }));
}
