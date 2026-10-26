import { AppHeader } from "@/components/layout/app-header";
import { useLanguage } from "@/context/language-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText } from "lucide-react";

export default function TermsOfServicePage() {
  const { language } = useLanguage();

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <AppHeader />
      <main className="flex-1 overflow-hidden p-6 flex flex-col">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <FileText size={20} />
            </div>
            <h1 className="text-2xl font-black tracking-tight leading-tight">
              {language === 'RU' ? 'Пользовательское соглашение' : 'Terms of Service'}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            {language === 'RU' ? 'Последнее обновление: 7 марта 2024' : 'Last Updated: March 7, 2024'}
          </p>
        </header>

        <ScrollArea className="flex-1 pr-4">
          <div className="prose prose-sm max-w-none space-y-6 text-foreground/80 leading-relaxed font-medium pb-12">
            {language === 'RU' ? (
              <>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">1. Принятие условий</h2>
                  <p>Регистрируясь в SwiftMatch, вы соглашаетесь соблюдать данные правила. Если вы не согласны с условиями, пожалуйста, не используйте Приложение.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">2. Возрастные ограничения</h2>
                  <p>Для использования Приложения вам должно быть не менее 18 лет. Мы имеем право заблокировать аккаунт, если возникнут подозрения в нарушении возрастного ценза.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">3. Правила поведения</h2>
                  <p>В SwiftMatch запрещено:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Использовать нецензурную лексику и оскорбления;</li>
                    <li>Размещать контент сексуального характера;</li>
                    <li>Заниматься спамом, рекламой или мошенничеством;</li>
                    <li>Создавать фейковые аккаунты или выдавать себя за другого человека.</li>
                  </ul>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">4. Платные услуги</h2>
                  <p>Приложение может предлагать платные функции (Premium, Boost). Оплата производится через сторонние сервисы. Мы не несем ответственности за сбои в работе банковских систем.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">5. Отказ от ответственности</h2>
                  <p>Мы не несем ответственности за поведение пользователей вне Приложения. Пожалуйста, соблюдайте правила безопасности при личных встречах.</p>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">1. Acceptance of Terms</h2>
                  <p>By registering with SwiftMatch, you agree to comply with these rules. If you do not agree with the terms, please do not use the Application.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">2. Age Restrictions</h2>
                  <p>You must be at least 18 years old to use the Application. We have the right to block an account if there are suspicions of a violation of the age limit.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">3. Code of Conduct</h2>
                  <p>In SwiftMatch it is prohibited to:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Use profanity and insults;</li>
                    <li>Post content of a sexual nature;</li>
                    <li>Engage in spam, advertising, or fraud;</li>
                    <li>Create fake accounts or impersonate another person.</li>
                  </ul>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">4. Paid Services</h2>
                  <p>The Application may offer paid features (Premium, Boost). Payment is made through third-party services. We are not responsible for failures in the operation of banking systems.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">5. Disclaimer</h2>
                  <p>We are not responsible for user behavior outside of the Application. Please follow safety rules during in-person meetings.</p>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
