import { useState, useRef, useEffect } from "react";
import { ChevronLeft, Send, MoreVertical, Smile, Heart, Laugh, Zap, Star, Flame, Eye, CheckCheck, Phone, Video, Timer, Clock } from "lucide-react";
import Image from "@/shims/next-image";
import { useRouter } from "@/shims/next-navigation";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/context/language-context";
import { toast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi, useApiMutation } from "@/hooks/useApi";
import { useAntiScreenshot } from "@/hooks/useAntiScreenshot";
import { getToken } from '@/lib/token';
import { BottomNav } from "@/components/navigation/bottom-nav";
import { format } from 'date-fns';
import { useAuth } from "@/context/auth-context";
import { useWebSocket } from "@/hooks/use-websocket";
import { useWebRTC } from "@/hooks/use-webrtc";
import { VideoCallDialog } from "@/components/video-call";
import { VoiceCallDialog } from "@/components/voice-call";
import { useTrackEvent } from "@/hooks/useExperiment";
import { formatEventDate } from "@/lib/hangouts";
import { CalendarHeart } from "lucide-react";
import { Link } from "react-router-dom";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { ChatPartnerActions } from "@/components/chat/chat-partner-actions";

const QUICK_REACTIONS = [
  { id: 'heart', icon: Heart, color: 'text-red-500', label: '❤️' },
  { id: 'flame', icon: Flame, color: 'text-orange-500', label: '🔥' },
  { id: 'zap', icon: Zap, color: 'text-yellow-400', label: '⚡' },
  { id: 'star', icon: Star, color: 'text-yellow-500', label: '⭐' },
  { id: 'smile', icon: Smile, color: 'text-green-500', label: '😊' },
  { id: 'laugh', icon: Laugh, color: 'text-orange-400', label: '😂' },
];

function ChatRoomSkeleton() {
    return (
      <div className="flex flex-col h-screen bg-[#f8f9fb]">
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border sticky top-0 bg-white/90 backdrop-blur-lg z-50 h-16">
          <Skeleton className="w-8 h-8 rounded-full" />
          <div className="w-10 h-10 rounded-full bg-muted" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="w-8 h-8 rounded-full" />
        </header>
        <main className="flex-1 overflow-y-auto p-4 space-y-4">
          <Skeleton className="h-10 w-3/4 rounded-lg self-start" />
          <Skeleton className="h-12 w-1/2 rounded-lg self-end" />
          <Skeleton className="h-8 w-2/3 rounded-lg self-start" />
          <Skeleton className="h-10 w-3/4 rounded-lg self-end" />
        </main>
      <div className="px-4 py-2 bg-white border-t">
            <Skeleton className="h-11 w-2xl rounded-2xl" />
        </div>
      </div>
    );
}

export default function ChatPage({ params }: { params: { chatId: string } }) {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();
  const { socket } = useWebSocket();
  const { partnerOffersEnabled } = useFeatureFlags();

  // Тот же гейт, что на /chats: без сессии сообщения не загрузятся (токен
  // берётся из хранилища, запрос уйдёт без заголовка и получит 401), поэтому
  // страница молча показывала бы пустой диалог. Уводим на вход.
  useEffect(() => {
    if (isAuthLoading) return;
    if (!user) router.replace('/login');
  }, [isAuthLoading, user, router]);

  const [inputValue, setInputValue] = useState("");
  const [selectedTtl, setSelectedTtl] = useState<number | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<any[]>([]);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const [reactionMsgId, setReactionMsgId] = useState<number | null>(null);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [isVoiceCall, setIsVoiceCall] = useState(false);
  const [isCallMuted, setIsCallMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const webrtc = useWebRTC(socket, user?.id ?? null);

  useEffect(() => {
    const handleResize = () => {
      setViewportHeight(window.innerHeight);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 100);
    };
    window.addEventListener('resize', handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }
    return () => {
      window.removeEventListener('resize', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
    };
  }, []);

  const msgContainerRef = useAntiScreenshot<HTMLDivElement>();

  const { data: messages, loading: messagesLoading, error: messagesError, refetch: refetchMessages } = useApi<any[]>(
    `/api/chats/${params.chatId}/messages`
  );
  const { data: chatPartner, loading: partnerLoading, error: partnerError } = useApi<any>(
    `/api/chats/${params.chatId}`
  );
  const [hangoutCtx, setHangoutCtx] = useState<{ id: number; title: string; event_date: string; category: string; status: string } | null>(null);

  useEffect(() => {
    const t = getToken();
    if (!t) return;
    fetch(`/api/hangouts/by-chat/${params.chatId}`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setHangoutCtx(data && data.id ? data : null))
      .catch(() => {});
  }, [params.chatId]);
  const trackEvent = useTrackEvent();
  const { mutate: sendMessage, loading: isSending } = useApiMutation();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = (behavior: ScrollBehavior = "auto") => messagesEndRef.current?.scrollIntoView({ behavior });

  useEffect(() => {
    scrollToBottom();
  }, [messages, optimisticMessages, viewportHeight]);

  useEffect(() => {
    if (params.chatId) {
      const t = getToken();
      fetch(`/api/chats/${params.chatId}/read`, { method: 'PUT', headers: t ? { Authorization: `Bearer ${t}` } : {} }).catch(() => {});
    }
  }, [params.chatId]);

  useEffect(() => {
    if (!socket) return
    const handler = (data: { chatId: number; messageIds: number[] }) => {
      if (data.chatId === Number(params.chatId)) {
        refetchMessages()
      }
    }
    socket.on('chat:message-deleted', handler)
    return () => { socket.off('chat:message-deleted', handler) }
  }, [socket, params.chatId])

  const handleSendMessage = async (textOverride?: string) => {
    const content = textOverride || inputValue.trim();
    if (!content) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = { id: tempId, text: content, sender_id: 'me', created_at: new Date().toISOString(), reactions: [], seen: false };

    setOptimisticMessages(prev => [...prev, optimisticMessage]);
    if (!textOverride) setInputValue("");

    try {
      const body: Record<string, unknown> = { text: content }
      if (selectedTtl) body.ttl_seconds = selectedTtl
      await sendMessage(`/api/chats/${params.chatId}/messages`, 'POST', body);
      trackEvent('message_sent', { chat_id: Number(params.chatId), ttl: selectedTtl ?? null });
    } catch (error) {
      toast({ title: t('error.generic_title'), description: t('error.send_message'), variant: "destructive" });
      setOptimisticMessages(prev => prev.filter(m => m.id !== tempId));
    } finally {
      refetchMessages();
      setOptimisticMessages([]);
      scrollToBottom();
    }
  };

  const toggleReaction = async (msgId: number, emoji: string) => {
    try {
      const t = getToken();
      const res = await fetch(`/api/chats/${params.chatId}/messages/${msgId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
        body: JSON.stringify({ emoji }),
      })
      if (res.ok) refetchMessages()
    } catch { /* ignored */ }
    setReactionMsgId(null)
  }

  const getReactionsGrouped = (reactions: any[]) => {
    const grouped: Record<string, { emoji: string; count: number; users: number[] }> = {}
    for (const r of reactions || []) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { emoji: r.emoji, count: 0, users: [] }
      grouped[r.emoji].count++
      grouped[r.emoji].users.push(r.user_id)
    }
    return Object.values(grouped)
  }

  const handleStartVideoCall = () => {
    setIsVideoCall(true);
    webrtc.startCall(chatPartner?.user_id, 'video');
  };

  const handleStartVoiceCall = () => {
    setIsVoiceCall(true);
    webrtc.startCall(chatPartner?.user_id, 'audio');
  };

  const isLoading = messagesLoading || partnerLoading;

  if (isLoading) {
    return <ChatRoomSkeleton />
  }

  if (messagesError || partnerError || !chatPartner) {
    return (
      <div className="flex flex-col items-center justify-center bg-muted" style={{ height: viewportHeight }}>
          <p className="text-muted-foreground font-medium">{t('error.chat_not_found')}</p>
          <Button onClick={() => router.back()} className="mt-4">{t('button.back')}</Button>
      </div>
    )
  }

  const allMessages = [...(messages || []), ...optimisticMessages];

  return (
    <div className="flex flex-col bg-[#f8f9fb]" style={{ height: viewportHeight }}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border sticky top-0 bg-white/90 backdrop-blur-lg z-50 h-16">
        <Button variant="ghost" size="icon" onClick={() => router.push('/chats')} className="rounded-full"><ChevronLeft size={24} /></Button>
        <Image src={chatPartner.avatar || '/default-avatar.png'} alt={chatPartner.name || 'User'} width={40} height={40} className="rounded-full bg-muted" />
        <div className="flex-1">
            <h3 className="font-bold text-sm truncate">{chatPartner.name}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={handleStartVideoCall} className="rounded-full text-muted-foreground hover:bg-muted/50"><Video size={18} /></Button>
        <Button variant="ghost" size="icon" onClick={handleStartVoiceCall} className="rounded-full text-muted-foreground hover:bg-muted/50"><Phone size={18} /></Button>
        <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-full"><MoreVertical size={18} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" />
        </DropdownMenu>
      </header>

      <main data-testid="message-list" ref={msgContainerRef} className="flex-1 overflow-y-auto anti-screenshot">
        {hangoutCtx && (
          <Link to={`/hangouts/${hangoutCtx.id}`} className="block px-4 pt-3">
            <div data-testid="chat-hangout-banner" className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900 transition-colors hover:bg-violet-100">
              <CalendarHeart size={16} className="shrink-0 text-violet-600" />
              <span className="truncate font-medium">{t('chats.hangout_context', { title: hangoutCtx.title })}</span>
              <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-violet-600">{formatEventDate(hangoutCtx.event_date)}</span>
            </div>
          </Link>
        )}
        <div className="flex flex-col min-h-full px-4 pt-4 pb-2 space-y-2">
          <div className="flex-1" />
          <div className="text-center my-2"><Badge variant="secondary">{t('chats.today')}</Badge></div>
          <AnimatePresence initial={false}>
            {allMessages.map((msg) => (
              <motion.div key={msg.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}
                className={cn("flex flex-col max-w-[80%]", msg.sender_id !== chatPartner.user_id ? "ml-auto items-end" : "items-start")} >
                <div className={cn("px-3 py-2 rounded-lg text-sm relative group", msg.sender_id !== chatPartner.user_id ? "gradient-bg text-white rounded-br-none" : "bg-white text-foreground rounded-bl-none border")}>
                  {msg.text}
                  <button onClick={() => setReactionMsgId(reactionMsgId === msg.id ? null : msg.id)}
                    className={cn("absolute -bottom-3 right-0 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity", msg.sender_id !== chatPartner.user_id ? "text-white" : "text-muted-foreground")}>
                    😊
                  </button>
                  {reactionMsgId === msg.id && (
                    <div className={cn("absolute bottom-full right-0 mb-1 flex gap-0.5 bg-white rounded-full shadow-lg border p-1 z-10", msg.sender_id !== chatPartner.user_id ? "" : "")}>
                      {QUICK_REACTIONS.map(r => (
                        <button key={r.id} onClick={(e) => { e.stopPropagation(); toggleReaction(msg.id, r.label); }} className="p-1 hover:bg-muted rounded-full text-sm">{r.label}</button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1 px-1">
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{msg.ttl_seconds && <Clock size={10} className="inline" />}{format(new Date(msg.created_at), 'HH:mm')}</span>
                  {msg.sender_id !== chatPartner.user_id && (
                    msg.seen
                      ? <CheckCheck size={12} className="text-blue-500" />
                      : <Eye size={12} className="text-muted-foreground/40" />
                  )}
                </div>
                {msg.reactions?.length > 0 && (
                  <div className="flex gap-1 mt-1 px-1">
                    {getReactionsGrouped(msg.reactions).map(rg => (
                      <button key={rg.emoji} onClick={() => toggleReaction(msg.id, rg.emoji)}
                        className="text-xs bg-white rounded-full px-1.5 py-0.5 border shadow-sm hover:bg-muted transition-colors">
                        {rg.emoji}<span className="text-[10px] ml-0.5 text-muted-foreground">{rg.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        <div ref={messagesEndRef} />
          </div>
        </main>

      <div className="p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] bg-white border-t">
        {partnerOffersEnabled && <div className="mb-2"><ChatPartnerActions placement="chat" /></div>}
         <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Input data-testid="message-input" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onFocus={() => setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 300)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder={t('chats.placeholder')} className="pr-24 h-11 bg-muted/50 border-0 rounded-xl" />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <Popover>
                <PopoverTrigger asChild><button className={cn("text-muted-foreground hover:text-primary transition-colors", selectedTtl && "text-primary")}><Timer size={16} /></button></PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-40 p-1.5 rounded-2xl border-0 shadow-2xl bg-white">
                  <div className="space-y-0.5">
                    {[{label: t('chats.ttl_off'), value: null}, {label: t('chats.ttl_5s'), value: 5}, {label: t('chats.ttl_30s'), value: 30}, {label: t('chats.ttl_1m'), value: 60}, {label: t('chats.ttl_5m'), value: 300}, {label: t('chats.ttl_1h'), value: 3600}, {label: t('chats.ttl_24h'), value: 86400}].map(opt => (
                      <button key={String(opt.value)} onClick={() => setSelectedTtl(opt.value)} className={cn("w-full text-left px-3 py-1.5 text-xs font-bold rounded-xl transition-all", selectedTtl === opt.value ? "gradient-bg text-white" : "text-muted-foreground hover:bg-muted")}>{opt.label}</button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild><button className="text-muted-foreground"><Smile size={16} /></button></PopoverTrigger>
                <PopoverContent side="top" align="end" className="p-2 w-auto">
                  <div className="grid grid-cols-6 gap-1">{QUICK_REACTIONS.map(r => <button key={r.id} onClick={() => handleSendMessage(r.label)} className="p-2 hover:bg-muted rounded-lg"><r.icon size={22} className={r.color}/></button>)}</div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <Button data-testid="send-button" size="icon" onClick={() => handleSendMessage()} disabled={!inputValue.trim() && !isSending} className="h-11 w-11 rounded-xl gradient-bg text-white">
            <Send size={18} />
          </Button>
        </div>
      </div>
      <BottomNav />

      {isVideoCall && (
        <VideoCallDialog
          open={isVideoCall}
          onOpenChange={setIsVideoCall}
          user={chatPartner}
          localStream={webrtc.localStream}
          remoteStream={webrtc.remoteStream}
          callState={webrtc.callState}
          endCall={webrtc.endCall}
          isMuted={isCallMuted}
          isVideoOff={isVideoOff}
          onToggleMute={() => setIsCallMuted(!isCallMuted)}
          onToggleVideo={() => setIsVideoOff(!isVideoOff)}
        />
      )}
      {isVoiceCall && (
        <VoiceCallDialog
          open={isVoiceCall}
          onOpenChange={setIsVoiceCall}
          user={chatPartner}
          localStream={webrtc.localStream}
          callState={webrtc.callState}
          endCall={webrtc.endCall}
          isMuted={isCallMuted}
          onToggleMute={() => setIsCallMuted(!isCallMuted)}
        />
      )}
    </div>
  );
}
