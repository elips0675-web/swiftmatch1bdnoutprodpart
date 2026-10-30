import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Heart, MessageCircle, MoveHorizontal as MoreHorizontal, Send, Share2, ChevronLeft, ChevronRight, ChevronDown, Search, CirclePlus as PlusCircle, X, Image } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/context/language-context";
import { containsForbiddenWords, isGibberish } from "@/lib/word-filter";
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { getToken } from '@/lib/token';

export interface FeedComment {
  id: number;
  author?: string;
  authorRu?: string;
  authorEn?: string;
  avatar?: string;
  text?: string;
  textRu?: string;
  textEn?: string;
  time?: string;
  timeRu?: string;
  timeEn?: string;
  imageUrl?: string;
}

export interface FeedPost {
  id: number;
  author?: string;
  authorRu?: string;
  authorEn?: string;
  group?: string;
  groupRu?: string;
  groupEn?: string;
  text?: string;
  textRu?: string;
  textEn?: string;
  time?: string;
  timeRu?: string;
  timeEn?: string;
  avatar?: string;
  images?: string[];
  likes: number;
  commentsCount: number;
  isLiked: boolean;
  comments: FeedComment[];
}

type ApiComment = {
  id: number;
  author?: string;
  avatar?: string;
  text?: string;
  imageUrl?: string;
  createdAt?: string;
};

type ApiPost = {
  id: number;
  author?: string;
  text?: string;
  createdAt?: string;
  avatar?: string;
  images?: string[];
  likes: number;
  likedByMe?: boolean;
  comments?: ApiComment[];
};


const PostText = ({ text, charLimit = 280 }: { text: string, charLimit?: number }) => {
  const { language } = useLanguage();
  const tr = (ru: string, en: string) => (language === "RU" ? ru : en);
  const [isExpanded, setIsExpanded] = useState(false);

  if (!text) return null;
  if (text.length <= charLimit) {
    return <p className="px-5 pb-2 text-gray-800 text-[15px] leading-relaxed whitespace-pre-wrap">{text}</p>;
  }

  return (
    <div className="px-5 pb-2 text-gray-800 text-[15px] leading-relaxed">
      <p className="whitespace-pre-wrap">
        {isExpanded ? text : `${text.substring(0, charLimit)}...`}
        <button onClick={() => setIsExpanded(!isExpanded)} className="text-blue-500 hover:underline ml-1 font-semibold text-sm">
          {isExpanded ? tr("Скрыть", "Hide") : tr("Показать больше", "Show more")}
        </button>
      </p>
    </div>
  );
};

const Lightbox = ({ images, selectedIndex, onClose }: { images: string[]; selectedIndex: number; onClose: () => void }) => {
  const [currentIndex, setCurrentIndex] = useState(selectedIndex);

  const goToNext = useCallback((e: React.MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % images.length);
  }, [images.length]);

  const goToPrevious = useCallback((e: React.MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  }, [images.length]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goToNext(e);
      if (e.key === 'ArrowLeft') goToPrevious(e);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goToNext, goToPrevious]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
    >
      <AnimatePresence initial={false}>
        <motion.img
          key={currentIndex}
          src={images[currentIndex]}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="max-h-[90vh] max-w-[90vw] object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      </AnimatePresence>
      <button className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors z-[101]" onClick={(e) => { e.stopPropagation(); onClose(); }}>
        <X size={32} />
      </button>
      {images.length > 1 && (
        <>
          <button className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/40 text-white p-2 rounded-full hover:bg-black/60 transition-all z-[101]" onClick={goToPrevious}>
            <ChevronLeft size={28} />
          </button>
          <button className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/40 text-white p-2 rounded-full hover:bg-black/60 transition-all z-[101]" onClick={goToNext}>
            <ChevronRight size={28} />
          </button>
        </>
      )}
    </motion.div>
  );
};

const PostImageGallery = ({ images }: { images: string[] }) => {
  const [isLightboxOpen, setLightboxOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const count = images.length;
  if (count === 0) return null;

  return (
    <div className="px-5 pt-1">
      <div className={cn("mt-2 rounded-xl overflow-hidden border border-gray-200/80 grid gap-0.5", count === 1 ? "grid-cols-1" : "grid-cols-2")}>
        {images.slice(0, count === 1 ? 1 : count === 2 ? 2 : 4).map((src, index) => (
          <div
            key={index}
            className={cn("bg-gray-200 cursor-pointer overflow-hidden", count === 3 && index === 0 ? "col-span-2 row-span-2" : "aspect-square")}
            onClick={() => { setSelectedIndex(index); setLightboxOpen(true); }}
          >
            <img src={src} alt={`Post image ${index + 1}`} className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
      {isLightboxOpen && <Lightbox images={images} selectedIndex={selectedIndex} onClose={() => setLightboxOpen(false)} />}
    </div>
  );
};

const PostImageUploader = ({ images, setImages, newPostImageUrls, setNewPostImageUrls }: {
  images: string[]; setImages: (images: string[]) => void; newPostImageUrls: string; setNewPostImageUrls: (urls: string) => void;
}) => {
  const { language } = useLanguage();
  const tr = (ru: string, en: string) => (language === "RU" ? ru : en);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxFiles = 14;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    const fileArray = Array.from(files).slice(0, maxFiles - images.length);
    fileArray.forEach((file) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) setImages([...images, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  };

  const removeImage = (index: number) => setImages(images.filter((_, i) => i !== index));

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
          {tr("Добавить фото", "Add photos")} ({images.length}/{maxFiles})
        </Label>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {images.map((image, index) => (
            <div key={image} className="relative aspect-square rounded-lg overflow-hidden border">
              <img src={image} alt={`preview ${index}`} className="w-full h-full object-cover" />
              <button type="button" onClick={() => removeImage(index)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 backdrop-blur-sm hover:bg-black/80 transition-colors">
                <X size={14} />
              </button>
            </div>
          ))}
          {images.length < maxFiles && (
            <button type="button" onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-blue-500 hover:text-blue-500 transition-colors">
              <PlusCircle size={24} />
              <span className="text-xs font-semibold mt-1">{tr("Добавить", "Add")}</span>
            </button>
          )}
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/png, image/jpeg, image/gif, image/webp" multiple />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="post-images-url" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
          {tr("Или по ссылке", "Or by link")}
        </Label>
        <Input id="post-images-url" value={newPostImageUrls} onChange={(e) => setNewPostImageUrls(e.target.value)} className="h-12 rounded-xl bg-muted/50 border-0" placeholder={tr("Вставьте ссылку на изображение", "Paste image URL")} />
      </div>
    </div>
  );
};

const AVATAR_POOL = [
  "/demo/people/anna.png",
  "/demo/people/ivan.png",
  "/demo/people/maxim.png",
  "/demo/people/artem.png",
  "/demo/people/elena.png",
  "/demo/people/me.png",
  "/demo/people/sophia.png",
  "/demo/people/support-agent.png",
];

function generatePosts(categoryName: string, categoryEn: string) {
  const seeds = [
    { authorRu: categoryName, authorEn: categoryEn, groupRu: "Общее", groupEn: "General", textRu: `Добро пожаловать в группу «${categoryName}»! Делитесь своими мыслями, находками и идеями.`, textEn: `Welcome to the "${categoryEn}" group! Share your thoughts, finds, and ideas.`, imgCount: 3 },
    { authorRu: "Эксперт", authorEn: "Expert", groupRu: "Обсуждение", groupEn: "Discussion", textRu: "Кто чем увлекается в последнее время? Поделитесь своими проектами и вдохновением!", textEn: "What have you been into lately? Share your projects and inspiration!", imgCount: 2 },
    { authorRu: "Новичок", authorEn: "Newbie", groupRu: "Вопросы", groupEn: "Questions", textRu: "Привет всем! Только начинаю разбираться в этой теме. Посоветуйте, с чего начать?", textEn: "Hey everyone! Just starting to explore this topic. Any advice on where to begin?", imgCount: 1 },
    { authorRu: "Мастер", authorEn: "Master", groupRu: "Мастер-класс", groupEn: "Masterclass", textRu: "Делюсь своим опытом и лучшими находками за последний год. Спрашивайте — отвечу на все вопросы!", textEn: "Sharing my experience and best finds over the past year. Ask me anything!", imgCount: 4 },
    { authorRu: "Обозреватель", authorEn: "Reviewer", groupRu: "Обзоры", groupEn: "Reviews", textRu: "Собрал лучшие ресурсы и материалы для всех уровней. Сохраняйте, чтобы не потерять!", textEn: "Collected the best resources and materials for all levels. Save this so you don't lose it!", imgCount: 5 },
    { authorRu: "Организатор", authorEn: "Organizer", groupRu: "События", groupEn: "Events", textRu: "На следующей неделе проводим встречу для всех желающих. Присоединяйтесь, будет интересно!", textEn: "Next week we're hosting a meetup for everyone. Join us, it'll be fun!", imgCount: 2 },
    { authorRu: "Коллекционер", authorEn: "Collector", groupRu: "Лучшее", groupEn: "Best Of", textRu: "Подборка самого интересного за месяц. 14 фото, листайте до конца!", textEn: "The most interesting picks of the month. 14 photos, scroll to the end!", imgCount: 14 },
    { authorRu: "Практик", authorEn: "Practitioner", groupRu: "Практика", groupEn: "Practice", textRu: "Теория — это хорошо, но практика важнее. Покажите свои результаты!", textEn: "Theory is good, but practice is more important. Show your results!", imgCount: 3 },
    { authorRu: "Путешественник", authorEn: "Traveler", groupRu: "География", groupEn: "Geography", textRu: "Лучшие места, которые стоит посетить этим летом. Фото внутри!", textEn: "Best places to visit this summer. Photos inside!", imgCount: 4 },
    { authorRu: "Историк", authorEn: "Historian", groupRu: "Факты", groupEn: "Facts", textRu: "Интересный факт: знаете ли вы, что...", textEn: "Interesting fact: did you know that...", imgCount: 1 },
    { authorRu: "Техно-гик", authorEn: "Tech Geek", groupRu: "Технологии", groupEn: "Tech", textRu: "Обзор нового гаджета, который вышел на этой неделе.", textEn: "Review of the new gadget that came out this week.", imgCount: 3 },
    { authorRu: "Кулинар", authorEn: "Chef", groupRu: "Рецепты", groupEn: "Recipes", textRu: "Рецепт идеального ужина за 30 минут. Проверено!", textEn: "Recipe for a perfect dinner in 30 minutes. Tested!", imgCount: 2 },
    { authorRu: "Спортсмен", authorEn: "Athlete", groupRu: "Тренировки", groupEn: "Workouts", textRu: "Моя программа тренировок на месяц. Результаты впечатляют!", textEn: "My month-long workout plan. Results are impressive!", imgCount: 5 },
    { authorRu: "Музыкант", authorEn: "Musician", groupRu: "Музыка", groupEn: "Music", textRu: "Треки, которые вдохновляют меня этой весной.", textEn: "Tracks that inspire me this spring.", imgCount: 1 },
    { authorRu: "Художник", authorEn: "Artist", groupRu: "Творчество", groupEn: "Art", textRu: "Мои новые работы в стиле цифровой живописи. Критика приветствуется!", textEn: "My new digital paintings. Feedback welcome!", imgCount: 4 },
    { authorRu: "Садовод", authorEn: "Gardener", groupRu: "Дача", groupEn: "Garden", textRu: "Как вырастить розы на собственном участке. Советы для начинающих.", textEn: "How to grow roses in your garden. Tips for beginners.", imgCount: 3 },
    { authorRu: "Киноман", authorEn: "Movie Buff", groupRu: "Кино", groupEn: "Movies", textRu: "Топ-10 фильмов, которые стоит посмотреть на выходных.", textEn: "Top 10 movies to watch this weekend.", imgCount: 2 },
    { authorRu: "Читатель", authorEn: "Reader", groupRu: "Книги", groupEn: "Books", textRu: "Закончил чтение отличной книги. Краткий обзор и впечатления.", textEn: "Finished a great book. Quick review and impressions.", imgCount: 1 },
    { authorRu: "Исследователь", authorEn: "Explorer", groupRu: "Наука", groupEn: "Science", textRu: "Новое открытие в мире науки, которое меняет всё.", textEn: "A new discovery in science that changes everything.", imgCount: 3 },
  ];

  const timesRu = ["45 минут назад", "1 час назад", "2 часа назад", "3 часа назад", "5 часов назад", "6 часов назад", "8 часов назад", "12 часов назад"];
  const timesEn = ["45 min ago", "1 hour ago", "2 hours ago", "3 hours ago", "5 hours ago", "6 hours ago", "8 hours ago", "12 hours ago"];
  const commentNames = [
    { ru: "Анна", en: "Anna" },
    { ru: "Иван", en: "Ivan" },
    { ru: "Максим", en: "Maxim" },
    { ru: "Елена", en: "Elena" },
  ];
  const commentSeeds = [
    { ru: "Отличная подборка, спасибо!", en: "Great selection, thanks!" },
    { ru: "Как раз искал такое.", en: "Just what I was looking for." },
    { ru: "Сохранил, чтобы не потерять.", en: "Saved it so I don't lose it." },
    { ru: "А можно подробнее?", en: "Could you elaborate?" },
    { ru: "Проверено на себе — работает.", en: "Tried it myself — it works." },
  ];

  return seeds.map((seed, i) => {
    const images = Array.from({ length: seed.imgCount }, (_, j) =>
      `https://picsum.photos/seed/${categoryEn.toLowerCase().replace(/\s+/g, '_')}_${i}_${j}/800/600`
    );
    const commentCount = i % 4;
    const comments = Array.from({ length: commentCount }, (_, k) => ({
      id: i * 100 + k + 1,
      authorRu: commentNames[(i + k) % commentNames.length].ru,
      authorEn: commentNames[(i + k) % commentNames.length].en,
      avatar: AVATAR_POOL[(i + k + 1) % AVATAR_POOL.length],
      timeRu: timesRu[(i + k) % timesRu.length],
      timeEn: timesEn[(i + k) % timesEn.length],
      textRu: commentSeeds[(i + k) % commentSeeds.length].ru,
      textEn: commentSeeds[(i + k) % commentSeeds.length].en,
    }));

    return {
      id: i + 1,
      authorRu: seed.authorRu,
      authorEn: seed.authorEn,
      groupRu: seed.groupRu,
      groupEn: seed.groupEn,
      avatar: AVATAR_POOL[i % AVATAR_POOL.length],
      timeRu: timesRu[i % timesRu.length],
      timeEn: timesEn[i % timesEn.length],
      textRu: seed.textRu,
      textEn: seed.textEn,
      images,
      likes: 100 + ((i * 137) % 4900),
      commentsCount: comments.length,
      isLiked: false,
      comments,
    };
  });
}

interface CategoryFeedProps {
  categoryNameRu: string;
  categoryNameEn: string;
  groupId?: string;
}

export function CategoryFeed({ categoryNameRu, categoryNameEn, groupId }: CategoryFeedProps) {
  const isApiMode = !!groupId;
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const { toast } = useToast();
  const { t, language } = useLanguage();

  useEffect(() => {
    if (isApiMode) {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch(`/api/groups/${groupId}/posts`, { headers })
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          const mapped = (data as ApiPost[]).map((p: ApiPost) => ({
            id: p.id,
            author: p.author,
            group: language === 'RU' ? categoryNameRu : categoryNameEn,
            text: p.text || '',
            time: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '',
            avatar: p.avatar || '',
            images: p.images || [],
            likes: p.likes,
            isLiked: Boolean(p.likedByMe),
            commentsCount: (p.comments || []).length,
            comments: (p.comments || []).map((c: ApiComment) => ({
              id: c.id, author: c.author, avatar: c.avatar || '',
              text: c.text || '', imageUrl: c.imageUrl,
              time: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
            })),
          }))
          setPosts(mapped);
        })
        .catch(() => setPosts([]));
    } else {
      setPosts(generatePosts(categoryNameRu, categoryNameEn));
    }
  }, [isApiMode, groupId, categoryNameRu, categoryNameEn, language]);

  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [commentInputs, setCommentInputs] = useState<{ [key: number]: string }>({});
  const [commentImages, setCommentImages] = useState<{ [key: number]: string }>({});
  const [commentsOpen, setCommentsOpen] = useState<Set<number>>(new Set());
  const commentFileRefs = useRef<{ [key: number]: HTMLInputElement }>({});
  const [isCreatePostOpen, setIsCreatePostOpen] = useState(false);
  const [newPostText, setNewPostText] = useState("");
  const [newPostImages, setNewPostImages] = useState<string[]>([]);
  const [newPostImageUrls, setNewPostImageUrls] = useState("");

  const toggleComments = (postId: number) => {
    setCommentsOpen(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  };

  const handleCommentImageSelect = (postId: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result) setCommentImages(prev => ({ ...prev, [postId]: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const tr = useCallback((ru: string, en: string) => (language === "RU" ? ru : en), [language]);

  const fallbackPool = useMemo(() => AVATAR_POOL, []);

  const normalizeUrl = useCallback(
    (url: string | undefined, fallbackIndex: number) => {
      if (!url) return fallbackPool[fallbackIndex % fallbackPool.length];
      return url;
    },
    [fallbackPool]
  );

  const localize = useCallback(
    (ru: string | undefined, en: string | undefined, fallback: string) => (ru || en ? tr(ru || '', en || '') : fallback),
    [tr]
  );

  const normalizedPosts = useMemo(() => {
    return posts.map((post) => ({
      ...post,
      author: localize(post.authorRu, post.authorEn, post.author || ''),
      group: localize(post.groupRu, post.groupEn, post.group || ''),
      time: localize(post.timeRu, post.timeEn, post.time || ''),
      text: localize(post.textRu, post.textEn, post.text || ''),
      avatar: normalizeUrl(post.avatar, post.id),
      images: (post.images || []).map((img: string, i: number) => normalizeUrl(img, i + post.id)),
      comments: (post.comments || []).map((c: FeedComment, i: number) => ({
        ...c,
        author: localize(c.authorRu, c.authorEn, c.author || ''),
        time: localize(c.timeRu, c.timeEn, c.time || ''),
        text: localize(c.textRu, c.textEn, c.text || ''),
        avatar: normalizeUrl(c.avatar, i + post.id),
      })),
    }));
  }, [posts, normalizeUrl, tr, localize]);

  const filteredPosts = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return normalizedPosts;
    return normalizedPosts.filter(
      (post) =>
        (post.text || '').toLowerCase().includes(query) ||
        (post.author || '').toLowerCase().includes(query) ||
        (post.group || '').toLowerCase().includes(query)
    );
  }, [searchQuery, normalizedPosts]);

  const POSTS_PER_PAGE = 15;
  const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE);
  const paginatedPosts = filteredPosts.slice(
    (currentPage - 1) * POSTS_PER_PAGE,
    currentPage * POSTS_PER_PAGE
  );

  useEffect(() => { setCurrentPage(1); }, [searchQuery]);

  const handleLike = useCallback((postId: number) => {
    if (groupId) {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch(`/api/groups/${groupId}/posts/${postId}/like`, { method: 'POST', headers })
        .then(r => {
          if (!r.ok) throw new Error('like failed');
          return r.json();
        })
        .then(data => {
          setPosts((current) =>
            current.map((post) =>
              post.id === postId
                ? { ...post, isLiked: !!data.liked, likes: post.likes + (data.liked ? 1 : -1) }
                : post
            )
          );
        })
        .catch(() => {
          toast({
            variant: 'destructive',
            title: tr('Не удалось поставить лайк', 'Could not like the post'),
            description: tr('Проверьте соединение и попробуйте снова.', 'Check your connection and try again.'),
          });
        });
    } else {
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? { ...post, isLiked: !post.isLiked, likes: post.isLiked ? post.likes - 1 : post.likes + 1 }
            : post
        )
      );
    }
  }, [groupId, toast, tr]);

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/chats?groupId=${groupId || ''}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: tr('Ссылка скопирована', 'Link copied'),
        description: tr('Скопируйте ссылку и отправьте другу.', 'Copy the link and send it to a friend.'),
      });
    } catch {
      toast({
        variant: 'destructive',
        title: tr('Не удалось скопировать', 'Could not copy'),
        description: url,
      });
    }
  }, [toast, tr, groupId]);

  const handleCommentChange = (postId: number, text: string) => {
    setCommentInputs((prev) => ({ ...prev, [postId]: text }));
  };

  const handleCommentSubmit = (postId: number) => {
    const commentText = commentInputs[postId] || '';
    const commentImage = commentImages[postId];
    if (!commentText.trim() && !commentImage) return;

    if (commentText.trim() && containsForbiddenWords(commentText)) {
      toast({ variant: 'destructive', title: t('filter.toast.title', { context: 'inappropriate' }), description: t('filter.toast.description', { context: 'inappropriate' }) });
      return;
    }

    if (commentText.trim() && isGibberish(commentText)) {
      toast({ variant: 'destructive', title: t('filter.toast.title', { context: 'gibberish' }), description: t('filter.toast.gibberish_description', { context: 'gibberish' }) });
      return;
    }

    if (groupId) {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch(`/api/groups/${groupId}/posts/${postId}/comments`, {
        method: 'POST', headers,
        body: JSON.stringify({ text: commentText, image_url: commentImage || null }),
      })
        .then(r => {
          if (!r.ok) throw new Error('comment failed');
          return r.json();
        })
        .then(newComment => {
          if (!newComment) return;
          setPosts((current) =>
            current.map((post) =>
              post.id === postId
                ? {
                    ...post,
                    comments: [...post.comments, {
                      id: newComment.id, author: newComment.author, avatar: newComment.avatar || '',
                      text: newComment.text || '', imageUrl: newComment.imageUrl,
                      time: new Date(newComment.createdAt).toLocaleDateString(),
                    }],
                    commentsCount: post.commentsCount + 1,
                  }
                : post
            )
          );
          setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
          setCommentImages((prev) => {
            const next = { ...prev };
            delete next[postId];
            return next;
          });
        })
        .catch(() => {
          toast({
            variant: 'destructive',
            title: tr('Не удалось отправить комментарий', 'Could not post the comment'),
            description: tr('Текст сохранён, попробуйте ещё раз.', 'Your text is kept, please try again.'),
          });
        });
    } else {
      const newComment: FeedComment = {
        id: Date.now(),
        author: tr("Вы", "You"),
        avatar: "/demo/people/me.png",
        time: tr("Только что", "Just now"),
        text: commentText,
        imageUrl: commentImage,
      };
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? { ...post, comments: [...post.comments, newComment], commentsCount: post.commentsCount + 1 }
            : post
        )
      );
      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
      setCommentImages((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    }
  };

  const closeCreatePost = () => {
    setIsCreatePostOpen(false);
    setNewPostText("");
    setNewPostImages([]);
    setNewPostImageUrls("");
  };

  const handleCreatePost = () => {
    const urlImages = newPostImageUrls.split(',').map((url) => url.trim()).filter((url) => url.startsWith('http'));
    const allImages = [...newPostImages, ...urlImages];

    if (!newPostText.trim() && allImages.length === 0) {
      toast({ variant: "destructive", title: tr("Пустой пост", "Empty post"), description: tr("Добавьте текст или изображение.", "Add text or an image.") });
      return;
    }

    if (groupId) {
      const token = getToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      fetch(`/api/groups/${groupId}/posts`, {
        method: 'POST', headers,
        body: JSON.stringify({ text: newPostText, images: allImages }),
      })
        .then(r => {
          if (!r.ok) throw new Error('create post failed');
          return r.json();
        })
        .then(post => {
          setPosts((current) => [{
            id: post.id, author: post.author, group: tr(categoryNameRu, categoryNameEn),
            text: post.text || '', time: post.createdAt ? new Date(post.createdAt).toLocaleDateString() : '',
            avatar: post.avatar || '', images: post.images || [],
            likes: 0, isLiked: false, commentsCount: 0, comments: [],
          }, ...current]);
          closeCreatePost();
          toast({ title: tr("Пост опубликован", "Post published") });
        })
        .catch(() => {
          toast({
            variant: 'destructive',
            title: tr('Не удалось опубликовать пост', 'Could not publish the post'),
            description: tr('Черновик сохранён, попробуйте ещё раз.', 'Your draft is kept, please try again.'),
          });
        });
    } else {
      const newPost = {
        id: Date.now(),
        authorRu: tr("Вы", "You"),
        authorEn: "You",
        groupRu: "Общее",
        groupEn: "General",
        textRu: newPostText,
        textEn: newPostText,
        timeRu: tr("Только что", "Just now"),
        timeEn: "Just now",
        avatar: "/demo/people/me.png",
        images: allImages,
        likes: 0,
        commentsCount: 0,
        isLiked: false,
        comments: [],
      };
      setPosts((current) => [newPost, ...current]);
      closeCreatePost();
      toast({ title: tr("Пост опубликован", "Post published") });
    }
  };

  return (
    <div className="bg-gray-100/30 font-sans">
      <div className="max-w-xl mx-auto py-4 px-3">
        <div className="flex gap-2 mb-4 px-1">
          <div className="relative flex-grow">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-12 h-11 bg-white border-gray-200/80 rounded-full shadow-sm text-sm font-medium focus:ring-2 focus:ring-blue-400 transition-all w-full"
              placeholder={tr("Поиск по постам...", "Search posts...")}
            />
          </div>
          <Button
            onClick={() => setIsCreatePostOpen(true)}
            className="h-11 w-11 p-0 rounded-full bg-white border-gray-200/80 shadow-sm text-gray-500 hover:bg-gray-50 active:scale-95"
          >
            <PlusCircle size={20} />
          </Button>
        </div>

        {paginatedPosts.map((post) => (
          <div key={post.id} className="bg-white rounded-xl shadow-sm mb-5 border border-gray-200/80 overflow-hidden">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden">
                  <img src={post.avatar} alt={post.author} className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="font-bold text-sm text-gray-800 flex items-center gap-1.5">
                    {post.author} <span className="font-medium text-gray-400">·</span>{" "}
                    <span className="font-medium text-blue-500 text-xs">{post.group}</span>
                  </p>
                  <p className="text-gray-500 text-xs font-medium">{post.time}</p>
                </div>
              </div>
              <button className="text-gray-400 hover:text-gray-600">
                <MoreHorizontal size={20} />
              </button>
            </div>

            <PostText text={post.text} />
            <PostImageGallery images={post.images} />

            <div className="px-5 py-2 flex justify-between items-center border-t border-gray-100 mt-3">
              <div className="flex items-center gap-5">
                <button
                  onClick={() => handleLike(post.id)}
                  className="flex items-center gap-2 text-gray-500 hover:text-red-500 transition-colors font-semibold text-sm py-2 group"
                >
                  <Heart size={20} className={`transition-all ${post.isLiked ? 'text-red-500 fill-red-500' : 'text-gray-400 group-hover:text-red-500/70'}`} />
                  <span className={post.isLiked ? 'text-red-500' : 'text-gray-500'}>{post.likes}</span>
                </button>
                <button className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors font-semibold text-sm py-2">
                  <MessageCircle size={20} className="text-gray-400" />
                  <span>{post.commentsCount}</span>
                </button>
              </div>
              <button onClick={handleShare} className="text-gray-400 hover:text-gray-800 py-2">
                <Share2 size={20} />
              </button>
            </div>

            <div className="border-t border-gray-100 bg-gray-50/50">
              <button
                onClick={() => toggleComments(post.id)}
                className="w-full flex items-center justify-between px-5 py-3 text-gray-600 hover:text-gray-800 transition-colors"
              >
                <span className="flex items-center gap-2 font-semibold text-sm">
                  <MessageCircle size={16} className="text-gray-400" />
                  {tr("Комментарии", "Comments")} ({post.commentsCount})
                </span>
                <ChevronDown
                  size={16}
                  className={cn(
                    "transition-transform duration-200",
                    commentsOpen.has(post.id) && "rotate-180"
                  )}
                />
              </button>

              <AnimatePresence initial={false}>
                {commentsOpen.has(post.id) && (
                  <motion.div
                    key="comments"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4">
                      {post.comments.map((comment: FeedComment) => (
                        <div key={comment.id} className="flex items-start gap-3 mb-4">
                          <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden mt-1 flex-shrink-0">
                            <img src={comment.avatar} alt={comment.author} className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 bg-gray-100 rounded-xl px-3 py-2">
                            <div className="flex items-baseline gap-2">
                              <p className="font-bold text-xs text-gray-800">{comment.author}</p>
                              <p className="text-gray-400 text-[10px]">{comment.time}</p>
                            </div>
                            {comment.text && <p className="text-sm text-gray-700 mt-1">{comment.text}</p>}
                            {comment.imageUrl && (
                              <img src={comment.imageUrl} alt={comment.author} className="mt-2 rounded-lg max-h-48 w-auto object-cover" />
                            )}
                          </div>
                        </div>
                      ))}

                      <div className="flex items-center gap-3 mt-2">
                        <div className="w-8 h-8 rounded-full bg-gray-300 font-bold text-white flex items-center justify-center text-sm flex-shrink-0">ME</div>
                        <div className="flex-1 relative flex flex-col gap-2 bg-gray-100 rounded-2xl px-3 py-2">
                          {commentImages[post.id] && (
                            <div className="relative w-20 h-20 rounded-lg overflow-hidden">
                              <img src={commentImages[post.id]} alt="pending" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => setCommentImages((prev) => {
                                  const next = { ...prev };
                                  delete next[post.id];
                                  return next;
                                })}
                                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={commentInputs[post.id] || ''}
                              onChange={(e) => handleCommentChange(post.id, e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleCommentSubmit(post.id)}
                              placeholder={tr("Напишите комментарий...", "Write a comment...")}
                              className="flex-1 bg-transparent py-1 text-sm focus:outline-none min-w-0"
                            />
                            <button
                              type="button"
                              onClick={() => commentFileRefs.current[post.id]?.click()}
                              className="text-gray-400 hover:text-blue-500 transition-colors flex-shrink-0"
                            >
                              <Image size={18} />
                            </button>
                            <button
                              onClick={() => handleCommentSubmit(post.id)}
                              className="text-gray-400 hover:text-blue-500 transition-colors flex-shrink-0"
                            >
                              <Send size={18} />
                            </button>
                          </div>
                          <input
                            type="file"
                            ref={el => { commentFileRefs.current[post.id] = el!; }}
                            onChange={(e) => handleCommentImageSelect(post.id, e)}
                            className="hidden"
                            accept="image/png, image/jpeg, image/gif, image/webp"
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ))}

        {totalPages > 1 && (
          <Pagination className="mb-4">
            <PaginationContent>
              <PaginationItem>
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </PaginationItem>
              {Array.from({ length: totalPages }, (_, i) => (
                <PaginationItem key={i + 1}>
                  <Button variant={currentPage === i + 1 ? "default" : "outline"} size="icon" className="h-9 w-9" onClick={() => setCurrentPage(i + 1)}>
                    {i + 1}
                  </Button>
                </PaginationItem>
              ))}
              <PaginationItem>
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        )}
      </div>

      <Toaster />
      <Dialog open={isCreatePostOpen} onOpenChange={setIsCreatePostOpen}>
        <DialogContent className="max-w-lg rounded-3xl p-6 border-0 app-shadow">
          <DialogHeader>
            <DialogTitle className="font-black tracking-tight text-xl">
              {tr("Создать пост", "Create post")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground font-medium pt-1">
              {tr(`Опубликуйте новый пост в ленте «${categoryNameRu}».`, `Publish a new post in the "${categoryNameEn}" feed.`)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 pt-4">
            <div className="space-y-2">
              <Label htmlFor="post-text" className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
                {tr("Текст поста", "Post text")}
              </Label>
              <Textarea
                id="post-text"
                value={newPostText}
                onChange={(e) => setNewPostText(e.target.value)}
                className="rounded-xl bg-muted/50 border-0 min-h-[80px]"
                placeholder={tr("Напишите что-нибудь...", "Write something...")}
              />
            </div>
            <PostImageUploader
              images={newPostImages}
              setImages={setNewPostImages}
              newPostImageUrls={newPostImageUrls}
              setNewPostImageUrls={setNewPostImageUrls}
            />
          </div>
          <DialogFooter className="pt-6">
            <Button
              onClick={handleCreatePost}
              className="w-full h-12 rounded-xl gradient-bg text-white font-black uppercase tracking-widest shadow-lg shadow-primary/20 border-0"
            >
              {tr("Опубликовать", "Publish")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
