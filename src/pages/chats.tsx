
import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, ChevronLeft, Send, MoveVertical as MoreVertical, Smile, Heart, Laugh, Zap, Flame, Star, Ghost, Rocket, Crown, Music, Phone, Video, Flag, Info, ChevronRight, Trash2, ThumbsUp, PartyPopper, Eye, Frown, Award, Compass, Coffee, MessageSquareQuote, PawPrint, Globe, Film, BookOpen, Baby, Sun, Timer, Clock, Calendar } from "lucide-react";
import Image from "@/shims/next-image";
import { useSearchParams, useRouter } from "@/shims/next-navigation";
import dynamic from "@/shims/next-dynamic";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { AppHeader } from "@/components/layout/app-header";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/context/language-context";
import { toast } from "@/hooks/use-toast";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { useAuth } from "@/context/auth-context";
import { getToken } from '@/lib/token';
import { GROUP_CATEGORIES } from '@/lib/demo-data';
import { containsForbiddenWords, isGibberish } from "@/lib/word-filter";
import { useAntiScreenshot } from "@/hooks/useAntiScreenshot";
import { useWebSocket } from "@/hooks/use-websocket";
import { useWebRTC } from "@/hooks/use-webrtc";
import { aiChatIcebreakerSuggestions } from "@/shims/ai-flows";

const VideoCallDialog = dynamic(() => import('@/components/video-call').then(mod => mod.VideoCallDialog), { ssr: false });
const VoiceCallDialog = dynamic(() => import('@/components/voice-call').then(mod => mod.VoiceCallDialog), { ssr: false });



function deleteConversation(chatId: number) {
  fetch(`/api/chats/${chatId}`, { method: 'DELETE' }).catch(() => {});
}

const Upload = ({ size }: { size: number }) => <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;

const GroupFeed = dynamic(() => import('@/components/feeds/category-feed').then(m => ({ default: m.CategoryFeed })), { ssr: false });

function formatRelativeTime(dateStr: string, locale: string = 'ru-RU'): string {
  const now = Date.now();
  const d = new Date(dateStr).getTime();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return locale === 'EN' ? 'just now' : 'только что';
  if (mins < 60) return `${mins}${locale === 'EN' ? 'm' : 'м'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}${locale === 'EN' ? 'h' : 'ч'}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}${locale === 'EN' ? 'd' : 'д'}`;
  return new Date(dateStr).toLocaleDateString(locale === 'EN' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'short' });
}

const QUICK_REACTIONS = [
  { id: 'heart', icon: Heart, color: 'text-red-500', label: '❤️' },
  { id: 'flame', icon: Flame, color: 'text-orange-500', label: '🔥' },
  { id: 'zap', icon: Zap, color: 'text-yellow-400', label: '⚡' },
  { id: 'star', icon: Star, color: 'text-yellow-500', label: '⭐' },
  { id: 'smile', icon: Smile, color: 'text-green-500', label: '😊' },
  { id: 'laugh', icon: Laugh, color: 'text-orange-400', label: '😂' },
  { id: 'thumbsup', icon: ThumbsUp, color: 'text-blue-500', label: '👍' },
  { id: 'partypopper', icon: PartyPopper, color: 'text-pink-500', label: '🎉' },
  { id: 'ghost', icon: Ghost, color: 'text-purple-400', label: '👻' },
  { id: 'rocket', icon: Rocket, color: 'text-blue-500', label: '🚀' },
  { id: 'crown', icon: Crown, color: 'text-amber-500', label: '👑' },
  { id: 'music', icon: Music, color: 'text-pink-400', label: '🎵' },
  { id: 'eye', icon: Eye, color: 'text-sky-500', label: '👀' },
  { id: 'frown', icon: Frown, color: 'text-orange-400', label: '😢' },
  { id: 'award', icon: Award, color: 'text-yellow-600', label: '💯' },
];

const CHAT_THEMES = [
  { id: 'romantic', labelKey: 'chats.theme.romantic', icon: Heart, color: 'text-pink-500', mood: 'Romantic, sweet and poetic' },
  { id: 'funny', labelKey: 'chats.theme.funny', icon: Laugh, color: 'text-orange-500', mood: 'Funny, witty and lighthearted' },
  { id: 'hobbies', labelKey: 'chats.theme.hobbies', icon: Compass, color: 'text-blue-500', mood: 'Focus on shared interests and activities' },
  { id: 'daily', labelKey: 'chats.theme.daily', icon: Coffee, color: 'text-amber-600', mood: 'Casual, relaxed daily life conversation' },
  { id: 'impressions', labelKey: 'chats.theme.impressions', icon: MessageSquareQuote, color: 'text-purple-500', mood: 'Sharing impressions and experiences' },
  { id: 'bold', labelKey: 'chats.theme.bold', icon: Zap, color: 'text-yellow-500', mood: 'Bold, confident and slightly flirty' },
  { id: 'pets', labelKey: 'chats.theme.pets', icon: PawPrint, color: 'text-amber-500', mood: 'Pets and animals conversation' },
  { id: 'travel', labelKey: 'chats.theme.travel', icon: Globe, color: 'text-emerald-500', mood: 'Travel and adventures' },
  { id: 'movies', labelKey: 'chats.theme.movies', icon: Film, color: 'text-red-500', mood: 'Movies, series and entertainment' },
  { id: 'books', labelKey: 'chats.theme.books', icon: BookOpen, color: 'text-indigo-500', mood: 'Books and literature' },
  { id: 'dreams', labelKey: 'chats.theme.dreams', icon: Star, color: 'text-yellow-400', mood: 'Dreams, goals and aspirations' },
  { id: 'childhood', labelKey: 'chats.theme.childhood', icon: Baby, color: 'text-pink-400', mood: 'Childhood memories and stories' },
  { id: 'nature', labelKey: 'chats.theme.nature', icon: Sun, color: 'text-orange-400', mood: 'Nature, weather and seasons' },
];

const ITEMS_PER_PAGE = 8;

function Pagination({ current, total, onChange }: { current: number, total: number, onChange: (p: number) => void }) {
  if (total <= 1) return null;

  const pages = [];
  for (let i = 1; i <= total; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-1.5 pt-4 pb-4">
      <Button 
        variant="outline" 
        size="icon" 
        className="w-8 h-8 rounded-lg border-muted bg-white" 
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
      >
        <ChevronLeft size={14} />
      </Button>
      
      {pages.map(p => (
        <Button
          key={p}
          variant={current === p ? "default" : "outline"}
          size="icon"
          className={cn(
            "w-8 h-8 rounded-lg text-xs font-black transition-all",
            current === p ? "gradient-bg border-0 text-white shadow-md scale-110" : "bg-white border-muted text-muted-foreground hover:bg-muted/50"
          )}
          onClick={() => onChange(p)}
        >
          {p}
        </Button>
      ))}

      <Button 
        variant="outline" 
        size="icon" 
        className="w-8 h-8 rounded-lg border-muted bg-white" 
        disabled={current === total}
        onClick={() => onChange(current + 1)}
      >
        <ChevronRight size={14} />
      </Button>
    </div>
  );
}

function ChatsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t, language } = useLanguage();
  const { videoCallsEnabled, aiIcebreakersEnabled } = useFeatureFlags();
  const { token: authToken, user } = useAuth();
  const { socket: wsSocket } = useWebSocket();
  const webrtc = useWebRTC(wsSocket, user?.id ?? null);
  const [isCallMuted, setIsCallMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const matchId = searchParams.get('matchId');
  const groupId = searchParams.get('groupId');

  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);

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

  const [selectedChat, setSelectedChat] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [selectedTtl, setSelectedTtl] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showTopicsDialog, setShowTopicsDialog] = useState(false);

  useEffect(() => {
    if (!wsSocket) return
    const handler = (data: { chatId: number; messageIds: number[] }) => {
      if (selectedChat?.id === data.chatId) {
        setMessages(prev => prev.filter(m => !data.messageIds.includes(m.id)))
      }
    }
    wsSocket.on('chat:message-deleted', handler)
    return () => { wsSocket.off('chat:message-deleted', handler) }
  }, [wsSocket, selectedChat?.id])

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const openingChatRef = useRef<number | null>(null);
  const [reactions, setReactions] = useState<Record<number, any[]>>({});
  const [reactionMsgId, setReactionMsgId] = useState<number | null>(null);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleDuration, setScheduleDuration] = useState(30);
  const [scheduleMessage, setScheduleMessage] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [reportDescription, setReportDescription] = useState('');
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [isVoiceCall, setIsVoiceCall] = useState(false);  
  const [currentPage, setCurrentPage] = useState(1);
  const [apiChats, setApiChats] = useState<any[]>([]);
  const [isChatsLoading, setIsChatsLoading] = useState(true);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [icebreakerSuggestions, setIcebreakerSuggestions] = useState<string[]>([]);
  const msgContainerRef = useAntiScreenshot<HTMLDivElement>();

  const allDirectChats = useMemo(() => {
    const seen = new Set<number>();
    return apiChats.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    }).map(c => ({
      id: c.id,
      other_user_id: c.other_user_id,
      name: c.display_name,
      img: c.avatar_url || '',
      online: c.online,
      lastMessage: c.last_message || '',
      time: c.updated_at ? formatRelativeTime(c.updated_at, language) : '',
      last_read_at: c.last_read_at,
      unread_count: c.unread_count || 0,
    }));
  }, [apiChats, language]);

  const filteredData = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return allDirectChats;
    return allDirectChats.filter(item =>
      item.name.toLowerCase().includes(query)
    );
  }, [searchQuery, allDirectChats]);

  const totalPages = Math.ceil(filteredData.length / ITEMS_PER_PAGE);
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredData.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredData, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => messagesEndRef.current?.scrollIntoView({ behavior });
  useEffect(() => { if (selectedChat) scrollToBottom(); }, [messages, selectedChat]);
  useEffect(() => { if (selectedChat) scrollToBottom("auto"); }, [viewportHeight]);



  useEffect(() => {
    if (!matchId || !authToken) return;
    const targetUserId = parseInt(matchId);
    if (isNaN(targetUserId) || targetUserId === user?.id) return;
    if (openingChatRef.current === targetUserId) return;
    const existing = apiChats.find(c => c.other_user_id === targetUserId);
    if (existing) {
      setSelectedChat({
        id: existing.id,
        name: existing.display_name,
        img: existing.avatar_url || '',
        online: existing.online,
      });
      fetch(`/api/chats/${existing.id}/messages`, { headers: { Authorization: `Bearer ${authToken}` } })
        .then(res => res.ok ? res.json() : [])
        .then(data => {
          if (Array.isArray(data)) {
            setMessages(data.map((m: any) => ({
              id: m.id, text: m.text,
              sender: m.sender_id === user?.id ? 'me' : 'other',
              time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              reactions: m.reactions || [],
            })));
            const rMap: Record<number, any[]> = {};
            data.forEach((m: any) => { if (m.reactions?.length) rMap[m.id] = m.reactions; });
            setReactions(rMap);
          }
        })
        .catch(() => {});
      openingChatRef.current = targetUserId;
      return;
    }

    if (!isChatsLoading) {
      fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ participant_id: targetUserId }),
      })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (!data) return;
          setSelectedChat({ id: data.id, name: '', img: '', online: false });
          if (data.existing) {
            fetch(`/api/chats/${data.id}/messages`, { headers: { Authorization: `Bearer ${authToken}` } })
              .then(res => res.ok ? res.json() : [])
              .then(msgs => {
                if (Array.isArray(msgs)) {
                  setMessages(msgs.map((m: any) => ({
                    id: m.id, text: m.text,
                    sender: m.sender_id === user?.id ? 'me' : 'other',
                    time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    reactions: m.reactions || [],
                  })));
                }
              })
              .catch(() => {});
          } else {
            setMessages([]);
          }
          fetch('/api/chats', { headers: { Authorization: `Bearer ${authToken}` } })
            .then(res => res.ok ? res.json() : [])
            .then(list => { if (Array.isArray(list)) setApiChats(list); })
            .catch(() => {});
        })
        .catch(() => {});
      openingChatRef.current = targetUserId;
    }
  }, [matchId, apiChats.length, isChatsLoading, authToken, user?.id]);

  useEffect(() => {
    if (groupId) {
      const allSubs = GROUP_CATEGORIES.flatMap(c => c.subgroups);
      const sub = allSubs.find(s => String(s.id) === groupId);
      const label = sub ? (language === 'RU' ? sub.name_ru : sub.name_en) : `Group #${groupId}`;
      setSelectedChat({ id: Number(groupId), name: label, img: '', online: false, isGroup: true });
    }
  }, [groupId, language]);

  useEffect(() => {
    if (!authToken) return;
    setIsChatsLoading(true);
    fetch('/api/chats', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (Array.isArray(data)) setApiChats(data); })
      .catch(() => {})
      .finally(() => setIsChatsLoading(false));
  }, [authToken]);

  useEffect(() => {
    if (!wsSocket) return;
    const handler = (event: { chatId: number; message: any }) => {
      setSelectedChat(prev => {
        if (prev && Number(prev.id) === event.chatId) {
          setMessages(prevMsgs => {
            if (prevMsgs.some(m => m.id === event.message.id)) return prevMsgs;
            return [...prevMsgs, {
              id: event.message.id,
              text: event.message.text,
              sender: 'other',
              time: new Date(event.message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              reactions: [],
            }];
          });
        } else {
          fetch('/api/chats', { headers: { Authorization: `Bearer ${authToken}` } })
            .then(res => res.ok ? res.json() : [])
            .then(data => { if (Array.isArray(data)) setApiChats(data); })
            .catch(() => {});
        }
        return prev;
      });
    };
    wsSocket.on('chat:message', handler);
    return () => { wsSocket.off('chat:message', handler); };
  }, [wsSocket, authToken]);

  const handleProposeDate = async () => {
    if (!scheduleDate || !scheduleTime || !selectedChat) return
    setIsScheduling(true)
    try {
      const scheduledAt = `${scheduleDate}T${scheduleTime}:00`
      const res = await fetch(`/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ chat_id: selectedChat.id, scheduled_at: scheduledAt, duration_minutes: scheduleDuration, message: scheduleMessage || undefined }),
      })
      if (res.ok) {
        toast({ title: t('schedule.propose'), variant: 'default' })
        setShowScheduleDialog(false)
        setScheduleDate('')
        setScheduleTime('')
        setScheduleMessage('')
        setScheduleDuration(30)
      } else {
        const err = await res.json()
        toast({ variant: 'destructive', title: err.message || t('error.generic_title') })
      }
    } catch {
      toast({ variant: 'destructive', title: t('error.generic_title') })
    }
    setIsScheduling(false)
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedChat) return;
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('user_id', '1');
      const token = getToken();
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const uploadData = await uploadRes.json();
      const imageUrl = uploadData.url || uploadData.path || '';

      const msgRes = await fetch(`/api/chats/${selectedChat.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text: '', image_url: imageUrl }),
      });
      if (msgRes.ok) {
        const msg = await msgRes.json();
        setMessages(prev => [...prev, { id: msg.id, text: '', image_url: imageUrl, sender: 'me', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), reactions: [] }]);
      }
    } catch {
      toast({ variant: 'destructive', title: 'Upload failed' });
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSendMessage = (textOverride?: string) => {
    const textToSend = textOverride || inputValue;
    if (!textToSend.trim()) return;

    if (containsForbiddenWords(textToSend)) {
      toast({ variant: 'destructive', title: t('filter.toast.title'), description: t('filter.toast.description') });
      return;
    }

    if (isGibberish(textToSend)) {
      toast({ variant: 'destructive', title: t('filter.toast.title'), description: t('filter.toast.gibberish_description') });
      return;
    }

    const body: Record<string, unknown> = { text: textToSend }
    if (selectedTtl) body.ttl_seconds = selectedTtl

    fetch(`/api/chats/${selectedChat.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(body),
    })
      .then(res => res.ok ? res.json() : null)
      .then(msg => {
        if (msg) {
          const newMessage = { id: msg.id, text: msg.text, sender: 'me', time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ttl_seconds: msg.ttl_seconds };
          const updated = [...messages, newMessage];
          setMessages(updated);
        }
      })
      .catch(() => {});
    if (!textOverride) setInputValue('');
  };

  const openChat = (chat: any) => {
    setSelectedChat(chat);
    setReactions({});
    const authH = { Authorization: `Bearer ${authToken}` };
    fetch(`/api/chats/${chat.id}/messages`, { headers: authH })
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          const msgs = data.map((m: any) => ({
            id: m.id,
            text: m.text,
            sender: m.sender_id === user?.id ? 'me' : 'other',
            time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            reactions: m.reactions || [],
          }));
          setMessages(msgs);
          const rMap: Record<number, any[]> = {};
          data.forEach((m: any) => { if (m.reactions?.length) rMap[m.id] = m.reactions; });
          setReactions(rMap);
        }
      })
      .catch(() => {});
    fetch(`/api/chats/${chat.id}/read`, { method: 'PUT', headers: authH }).catch(() => {});
  };

  useEffect(() => {
    if (!selectedChat || selectedChat.isGroup || messages.length > 0 || !aiIcebreakersEnabled) {
      setIcebreakerSuggestions([]);
      return;
    }
    let cancelled = false;
    aiChatIcebreakerSuggestions({ chatUserId: selectedChat.other_user_id, language: language === 'EN' ? 'en' : 'ru' })
      .then(({ suggestions }) => { if (!cancelled) setIcebreakerSuggestions(suggestions); })
      .catch(() => { if (!cancelled) setIcebreakerSuggestions([]); });
    return () => { cancelled = true; };
  }, [selectedChat, messages.length, aiIcebreakersEnabled, language]);

  const handleThemeClick = (themeId: string) => {
    setInputValue(t(`chats.theme_prompt.${themeId}`));
    setShowTopicsDialog(false);
  };

  const toggleReaction = async (msgId: number, emoji: string) => {
    try {
      const res = await fetch(`/api/chats/${selectedChat.id}/messages/${msgId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ emoji }),
      })
      if (res.ok) {
        const data = await res.json()
        setReactions(prev => {
          const next = { ...prev }
          const existing = (next[msgId] || []).filter(r => r.emoji !== emoji)
          if (data.action === 'removed') {
            next[msgId] = existing
          } else {
            next[msgId] = [...existing, data]
          }
          return next
        })
      }
    } catch { /* ignored */ }
    setReactionMsgId(null)
  }

  const handleBack = () => {
    if (matchId || groupId) {
      router.back();
    } else {
      setSelectedChat(null);
    }
  };

  if (groupId && selectedChat?.isGroup) {
    return (
      <>
        <AppHeader />
        <div className="flex-1 overflow-y-auto pb-24">
          <GroupFeed categoryNameRu={selectedChat.name} categoryNameEn={selectedChat.name} groupId={groupId} />
        </div>
        <BottomNav />
      </>
    );
  }

  if (selectedChat) {
    return (
      <>
      <div className="flex flex-col bg-[#f8f9fb]" style={{ height: `calc(${viewportHeight}px - 4rem)` }}>
        <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-white/90 backdrop-blur-lg z-50 h-16 shrink-0">
          <Button variant="ghost" size="icon" onClick={handleBack} className="rounded-full hover:bg-muted/50"><ChevronLeft size={24} /></Button>
          <div className="relative">
            <div className="w-10 h-10 rounded-full overflow-hidden relative border-2 border-white shadow-sm bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
              {selectedChat.img ? <Image src={selectedChat.img} alt={selectedChat.name || ''} fill sizes="40px" className="object-cover" />
              : <span className="text-white font-black text-base">{selectedChat.name ? selectedChat.name.trim().charAt(0).toUpperCase() : '?'}</span>}
            </div>
            {selectedChat.online && <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#2ecc71] border-2 border-white rounded-full shadow-sm"></span>}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-black text-sm leading-tight tracking-tight text-foreground truncate">{selectedChat.name}</h3>
            <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">
              {selectedChat.online ? `• ${t('chats.online')}` : t('chats.offline')}
            </p>
          </div>
          <div className="flex items-center">
            {!selectedChat.isGroup && videoCallsEnabled && <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:bg-muted/50" onClick={() => setIsVideoCall(true)}><Video size={18} /></Button>}
            {!selectedChat.isGroup && <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:bg-muted/50" onClick={() => setIsVoiceCall(true)}><Phone size={18} /></Button>}
            {!selectedChat.isGroup && <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:bg-muted/50" onClick={() => setShowScheduleDialog(true)}><Calendar size={18} /></Button>}
            <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:bg-muted/50" onClick={() => setShowTopicsDialog(true)}><Info size={18} /></Button>
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground hover:bg-muted/50"><MoreVertical size={18} /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-2xl border-0 app-shadow p-1.5 min-w-[160px] bg-white">
                    <DropdownMenuItem onSelect={() => { deleteConversation(selectedChat.id); handleBack(); }} className="rounded-xl font-bold text-[10px] uppercase tracking-wider cursor-pointer py-2 text-destructive focus:text-destructive focus:bg-destructive/10">
                        <Trash2 size={14} className="mr-2" />
                        {t('chats.delete_conversation')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setIsReportDialogOpen(true); }} className="rounded-xl font-bold text-[10px] uppercase tracking-wider cursor-pointer py-2 text-destructive focus:text-destructive focus:bg-destructive/10">
                        <Flag size={14} className="mr-2" />
                        {t('button.report')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main ref={msgContainerRef} className="flex-1 overflow-y-auto anti-screenshot [overflow-anchor:auto]">
          <div className="flex flex-col min-h-full px-4 pt-4 pb-2 space-y-2">
            <div className="flex-1" />
            <div className="text-center my-2"><Badge variant="secondary" className="bg-white/50 text-[9px] text-muted-foreground border-0 font-black uppercase tracking-widest px-2.5 py-0.5">{t('chats.today')}</Badge></div>
            {messages.length === 0 && icebreakerSuggestions.length > 0 && (
              <div className="mb-2 px-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{t('chats.icebreakers.title')}</p>
                <div className="flex flex-wrap gap-2">
                  {icebreakerSuggestions.map((s) => (
                    <button
                      key={s}
                      data-testid="icebreaker-chip"
                      onClick={() => { setIcebreakerSuggestions([]); handleSendMessage(s); }}
                      className="text-left text-xs font-medium px-3 py-2 rounded-2xl bg-white border border-border/40 shadow-sm hover:bg-primary/10 hover:border-primary/20 active:scale-95 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div data-testid="message-list"><AnimatePresence>{messages.map((msg: any) => {
              const msgReactions = reactions[msg.id] || [];
              const reactionEmojis = [...new Set(msgReactions.map((r: any) => r.emoji))];
              const isReactionPickerOpen = reactionMsgId === msg.id;
              return (
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} key={msg.id} className={cn("flex flex-col max-w-[80%]", msg.sender === "me" ? "ml-auto items-end" : "items-start")}>
                <div onClick={() => setReactionMsgId(isReactionPickerOpen ? null : msg.id)} className={cn("px-3 py-2 rounded-lg text-sm shadow-sm font-medium leading-snug text-left w-full transition-all active:scale-95", msg.sender === "me" ? "gradient-bg text-white rounded-br-none shadow-primary/10" : "bg-white text-foreground rounded-bl-none border border-border/40")}>
                  {msg.image_url && <img src={msg.image_url} alt="" className="w-full rounded-lg mb-2 max-h-64 object-cover" />}
                  {msg.text && <p>{msg.text}</p>}
                </div>
                {reactionEmojis.length > 0 && (
                  <div className={cn("flex gap-1 mt-1", msg.sender === "me" ? "justify-end" : "justify-start")}>
                    {reactionEmojis.map(emoji => (
                      <button key={emoji} onClick={(e) => { e.stopPropagation(); toggleReaction(msg.id, emoji); }} className="text-xs bg-white/70 rounded-full px-1.5 py-0.5 border border-border/30 shadow-sm hover:bg-muted/50 transition-all active:scale-90">
                        {emoji} <span className="text-[9px] text-muted-foreground font-bold">{msgReactions.filter((r: any) => r.emoji === emoji).length}</span>
                      </button>
                    ))}
                    <button onClick={() => setReactionMsgId(isReactionPickerOpen ? null : msg.id)} className="text-muted-foreground/50 hover:text-muted-foreground transition-all"><Smile size={12} /></button>
                  </div>
                )}
                {reactionEmojis.length === 0 && (
                  <div className={cn("flex mt-0.5", msg.sender === "me" ? "justify-end" : "justify-start")}>
                    <button onClick={() => setReactionMsgId(isReactionPickerOpen ? null : msg.id)} className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-all"><Smile size={10} /></button>
                  </div>
                )}
                {isReactionPickerOpen && (
                  <div className={cn("flex gap-1 mt-1 p-1.5 bg-white rounded-xl border border-border/40 shadow-lg", msg.sender === "me" ? "justify-end" : "justify-start")}>
                    {QUICK_REACTIONS.map(reaction => {
                      const ReactionIcon = reaction.icon;
                      return (
                        <button key={reaction.id} onClick={() => toggleReaction(msg.id, reaction.label)} className="w-7 h-7 flex items-center justify-center hover:bg-muted rounded-lg transition-all active:scale-90">
                          <span className="[transform:translateZ(0)] scale-75"><ReactionIcon size={18} className={reaction.color} /></span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <span className="flex items-center gap-1 text-[9px] text-muted-foreground mt-1 px-1 font-bold uppercase tracking-tighter opacity-60">{msg.ttl_seconds && <Clock size={10} className="inline" />}{msg.time}</span>
              </motion.div>
            )})}</AnimatePresence></div>
            {isTyping && (<motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-1.5 text-muted-foreground"><div className="flex gap-1 bg-white px-3 py-2.5 rounded-lg border border-border/40 shadow-sm rounded-bl-none"><span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce"></span><span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:0.2s]"></span><span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:0.4s]"></span></div><span className="text-[9px] font-bold uppercase tracking-widest">{t('chats.typing')}</span></motion.div>)}
            <div ref={messagesEndRef} />
          </div>
        </main>
        <div className="shrink-0 px-4 py-3 bg-white border-t border-border">
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Input data-testid="message-input" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onFocus={() => setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "auto" }), 300)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder={t('chats.placeholder')} className="pr-20 h-11 bg-muted/50 border-0 rounded-2xl font-medium px-5 text-sm" />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <Popover>
                  <PopoverTrigger asChild><button className={cn("text-muted-foreground hover:text-primary transition-colors", selectedTtl && "text-primary")}><Timer size={16} /></button></PopoverTrigger>
                  <PopoverContent className="w-40 p-1.5 rounded-2xl border-0 shadow-2xl bg-white" side="top" align="end">
                    <div className="space-y-0.5">
                      {[{label: t('chats.ttl_off'), value: null}, {label: t('chats.ttl_5s'), value: 5}, {label: t('chats.ttl_30s'), value: 30}, {label: t('chats.ttl_1m'), value: 60}, {label: t('chats.ttl_5m'), value: 300}, {label: t('chats.ttl_1h'), value: 3600}, {label: t('chats.ttl_24h'), value: 86400}].map(opt => (
                        <button key={String(opt.value)} onClick={() => setSelectedTtl(opt.value)} className={cn("w-full text-left px-3 py-1.5 text-xs font-bold rounded-xl transition-all", selectedTtl === opt.value ? "gradient-bg text-white" : "text-muted-foreground hover:bg-muted")}>{opt.label}</button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild><button className="text-muted-foreground"><Smile size={16} /></button></PopoverTrigger>
                  <PopoverContent className="w-full max-w-[280px] p-2 rounded-2xl border-0 shadow-2xl bg-white" side="top" align="end">
                    <div className="grid grid-cols-5 gap-1">{QUICK_REACTIONS.map(reaction => { const ReactionIcon = reaction.icon; return (<button key={reaction.id} onClick={() => handleSendMessage(reaction.label)} className="w-10 h-10 flex items-center justify-center hover:bg-muted rounded-xl transition-all active:scale-90"><span className="[transform:translateZ(0)]"><ReactionIcon size={24} className={reaction.color} /></span></button>); })}</div>
                  </PopoverContent>
                </Popover>
              </div>
              {selectedChat?.isGroup && (
                <>
                  <input id="group-image-upload" type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                  <label htmlFor="group-image-upload" className="cursor-pointer text-muted-foreground hover:text-primary transition-colors">
                    {uploadingImage ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                  </label>
                </>
              )}
            </div>
            <Button data-testid="send-button" size="icon" onClick={() => handleSendMessage()} disabled={!inputValue.trim()} className="h-11 w-11 rounded-2xl gradient-bg text-white shadow-xl shadow-primary/30 active:scale-95 transition-all shrink-0"><Send size={18} className="ml-0.5" /></Button>
          </div>
        </div>
        {selectedChat && !selectedChat.isGroup && isVideoCall && <VideoCallDialog open={isVideoCall} onOpenChange={setIsVideoCall} user={selectedChat} localStream={webrtc.localStream} remoteStream={webrtc.remoteStream} callState={webrtc.callState} endCall={webrtc.endCall} isMuted={isCallMuted} isVideoOff={isVideoOff} onToggleMute={() => setIsCallMuted(p => !p)} onToggleVideo={() => setIsVideoOff(p => !p)} />}
        {selectedChat && !selectedChat.isGroup && isVoiceCall && <VoiceCallDialog open={isVoiceCall} onOpenChange={setIsVoiceCall} user={selectedChat} localStream={webrtc.localStream} callState={webrtc.callState} endCall={webrtc.endCall} isMuted={isCallMuted} onToggleMute={() => setIsCallMuted(p => !p)} />}
        {selectedChat && selectedChat.isGroup && isVideoCall && <VideoCallDialog open={isVideoCall} onOpenChange={setIsVideoCall} user={selectedChat} localStream={webrtc.localStream} remoteStream={webrtc.remoteStream} callState={webrtc.callState} endCall={webrtc.endCall} isMuted={isCallMuted} isVideoOff={isVideoOff} onToggleMute={() => setIsCallMuted(p => !p)} onToggleVideo={() => setIsVideoOff(p => !p)} />}
        {selectedChat && selectedChat.isGroup && isVoiceCall && <VoiceCallDialog open={isVoiceCall} onOpenChange={setIsVoiceCall} user={selectedChat} localStream={webrtc.localStream} callState={webrtc.callState} endCall={webrtc.endCall} isMuted={isCallMuted} onToggleMute={() => setIsCallMuted(p => !p)} />}

        <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
          <DialogContent className="max-w-sm rounded-2xl border-0 p-6 bg-white app-shadow">
            <DialogTitle className="text-lg font-black text-center">{t('schedule.propose')}</DialogTitle>
            <div className="space-y-4 mt-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">{t('schedule.date')}</label>
                <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="w-full h-11 px-4 bg-muted/50 border-0 rounded-xl text-sm font-medium" min={new Date().toISOString().split('T')[0]} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">{t('chats.online')}</label>
                <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="w-full h-11 px-4 bg-muted/50 border-0 rounded-xl text-sm font-medium" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">{t('schedule.duration')}</label>
                <select value={scheduleDuration} onChange={e => setScheduleDuration(Number(e.target.value))} className="w-full h-11 px-4 bg-muted/50 border-0 rounded-xl text-sm font-medium">
                  {[15, 30, 45, 60, 90, 120].map(m => (
                    <option key={m} value={m}>{t('schedule.minutes', { n: m })}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 block">{t('schedule.message')}</label>
                <textarea value={scheduleMessage} onChange={e => setScheduleMessage(e.target.value)} className="w-full h-20 px-4 py-3 bg-muted/50 border-0 rounded-xl text-sm font-medium resize-none" placeholder={t('chats.placeholder')} />
              </div>
              <Button onClick={handleProposeDate} disabled={!scheduleDate || !scheduleTime || isScheduling} className="w-full h-11 rounded-xl gradient-bg text-white font-bold gap-2">
                {isScheduling ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Calendar size={16} />}
                {t('schedule.propose_btn')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={showTopicsDialog} onOpenChange={setShowTopicsDialog}>
          <DialogContent className="max-w-sm rounded-2xl border-0 p-6 bg-white app-shadow">
            <DialogTitle className="text-lg font-black text-center">{t('chats.popular_topics')}</DialogTitle>
            <div className="grid grid-cols-2 gap-2">
              {CHAT_THEMES.map((theme) => {
                const Icon = theme.icon;
                return (
                  <button
                    key={theme.id}
                    onClick={() => handleThemeClick(theme.id)}
                    className="flex items-center gap-2 px-3 py-3 rounded-xl border border-border/40 bg-muted/20 hover:bg-primary/10 hover:border-primary/20 active:scale-95 transition-all text-left"
                  >
                    <span className="[transform:translateZ(0)]"><Icon size={18} className={`${theme.color} flex-shrink-0`} /></span>
                    <span className="text-[11px] font-bold leading-tight">{t(theme.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <BottomNav />
    </>
  );
  }

  return (
    <>
      <AppHeader />
      <main className="flex-1 overflow-y-auto px-5 pt-6 pb-24 bg-[#f8f9fb]">
        <div className="flex justify-between items-center mb-6 px-1">
          <div>
            <h2 className="text-2xl font-black font-headline tracking-tight text-foreground">{t('chats.title')}</h2>
            <p className="text-[10px] text-muted-foreground font-black uppercase tracking-widest mt-0.5 opacity-60">{t('chats.subtitle')}</p>
          </div>
          <Badge className="gradient-bg text-white rounded-full px-3 py-1 font-black text-[10px] border-0 shadow-lg shadow-primary/20">3 {t('activity.new')}</Badge>
        </div>

        <div className="relative mb-8 px-1">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground/60" size={16} />
          <Input data-testid="chat-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-12 h-12 bg-white border-0 rounded-2xl app-shadow text-sm font-medium" 
            placeholder={t('chats.search')}
          />
        </div>

        <div className="space-y-1 px-1">
          {isChatsLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : paginatedItems.length > 0 ? (
            paginatedItems.map((item) => {
              const hasUnread = (item.unread_count || 0) > 0;
              return (
                <div key={item.id} data-testid={`chat-row-${item.id}`} onClick={() => openChat(item)} className={cn(
                  "flex items-center gap-3 p-3 rounded-2xl transition-all cursor-pointer group border border-white mb-2",
                  "bg-white app-shadow hover:bg-muted/30"
                )}>
                    <div className="relative flex-shrink-0">
                      <div className={cn(
                        "w-12 h-12 rounded-xl overflow-hidden border-2 border-white shadow-sm transition-transform group-hover:scale-105 bg-muted flex items-center justify-center"
                      )}>
                        {item.img ? <Image src={item.img} alt={item.name || ''} fill sizes="48px" className="object-cover" />
                        : <span className="text-primary font-black text-lg">{item.name ? item.name.trim().charAt(0).toUpperCase() : '?'}</span>}
                      </div>
                    {item.online && <span className="absolute bottom-0 right-0 w-3 h-3 border-2 border-white rounded-full shadow-md bg-[#2ecc71]"></span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="font-black text-sm text-foreground tracking-tight group-hover:text-primary transition-colors truncate">
                          {item.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-bold opacity-60 flex-shrink-0 ml-2">{item.time}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className={cn(
                          "text-xs truncate pr-2 font-medium leading-snug",
                          hasUnread ? "text-foreground font-bold" : "text-muted-foreground opacity-80"
                        )}>
                          {item.lastMessage}
                        </p>
                      </div>
                      {hasUnread && (
                        <Badge className="h-5 min-w-[20px] px-1.5 gradient-bg text-white border-0 text-[9px] font-black flex items-center justify-center rounded-full scale-90 shadow-lg shadow-primary/20">
                          {item.unread_count}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-20 opacity-30 flex flex-col items-center gap-4">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
                <Info size={24} />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest">{t('activity.empty')}</p>
            </div>
          )}

          <Pagination current={currentPage} total={totalPages} onChange={setCurrentPage} />
        </div>
      </main>
      <BottomNav />
    </>
  );
}

export default function ChatsPage() {
  return (
    <ChatsContent />
  );
}
