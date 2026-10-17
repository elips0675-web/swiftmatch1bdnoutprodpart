
import { AppHeader } from "@/components/layout/app-header";
import { useLanguage } from "@/context/language-context";
import { Code as Code2, Cpu, Database, Layers, Zap, Sparkles, LayoutGrid as Layout, Smartphone, CircleCheck as CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";

export default function AboutPage() {
  const { t } = useLanguage();

  const techItems = [
    {
      title: t('about.frontend.title'),
      desc: t('about.frontend.desc'),
      icon: <Layout className="text-blue-500" />,
      tags: ['React 18', 'Vite', 'Tailwind']
    },
    {
      title: t('about.backend.title'),
      desc: t('about.backend.desc'),
      icon: <Database className="text-orange-500" />,
      tags: ['Express', 'MySQL 8', 'Socket.io']
    },
    {
      title: t('about.ai.title'),
      desc: t('about.ai.desc'),
      icon: <Sparkles className="text-purple-500" />,
      tags: ['OpenAI']
    },
    {
      title: t('about.performance.title'),
      desc: t('about.performance.desc'),
      icon: <Zap className="text-amber-500" />,
      tags: ['Lazy loading', 'Code-splitting']
    }
  ];

  return (
    <div className="flex flex-col min-h-screen bg-[#f8f9fb]">
      <AppHeader />
      <main className="flex-1 overflow-y-auto p-6 space-y-8">
        <header className="text-center space-y-4">
          <div className="inline-flex p-4 bg-white rounded-xl app-shadow mb-2 border border-border/40">
            <Code2 size={32} className="text-primary" />
          </div>
          <h2 className="text-3xl font-black font-headline tracking-tighter text-foreground leading-none">
            {t('about.title')}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto font-medium">
            {t('about.description')}
          </p>
        </header>

        <section className="space-y-4">
          <div className="flex items-center gap-2 px-1">
            <Layers size={18} className="text-primary" />
            <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              {t('about.stack.title')}
            </h3>
          </div>

          <div className="grid gap-4">
            {techItems.map((item, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.1 }}
              >
                <Card className="border-0 app-shadow bg-white rounded-xl overflow-hidden">
                  <CardContent className="p-5 flex gap-4">
                    <div className="w-12 h-12 rounded-lg bg-muted/30 flex items-center justify-center shrink-0">
                      {item.icon}
                    </div>
                    <div className="space-y-2">
                      <h4 className="font-black text-sm">{item.title}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed font-medium">
                        {item.desc}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {item.tags.map(tag => (
                          <Badge key={tag} variant="secondary" className="bg-muted/50 text-[9px] font-bold uppercase tracking-tight py-0.5 px-2">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="bg-primary/5 rounded-2xl p-8 border border-primary/10 text-center space-y-4">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto app-shadow border border-primary/10">
            <Smartphone size={28} className="text-primary" />
          </div>
          <h4 className="font-black text-lg tracking-tight">Mobile First MVP</h4>
          <p className="text-xs text-muted-foreground leading-relaxed font-medium">
            {t('about.mobile.desc')}
          </p>
          <div className="flex justify-center gap-4 pt-2">
            <div className="flex items-center gap-1 text-[10px] font-black text-primary uppercase">
              <CheckCircle2 size={12} /> Real-time
            </div>
            <div className="flex items-center gap-1 text-[10px] font-black text-primary uppercase">
              <CheckCircle2 size={12} /> AI-Powered
            </div>
            <div className="flex items-center gap-1 text-[10px] font-black text-primary uppercase">
              <CheckCircle2 size={12} /> Optimized
            </div>
          </div>
        </section>

        <footer className="text-center pt-4 pb-12">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
            SwiftMatch v1.0.0
          </p>
        </footer>
      </main>
    </div>
  );
}
