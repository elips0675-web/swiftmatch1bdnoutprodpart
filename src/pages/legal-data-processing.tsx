import { AppHeader } from "@/components/layout/app-header";
import { useLanguage } from "@/context/language-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database } from "lucide-react";

export default function DataProcessingConsentPage() {
  const { language } = useLanguage();

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <AppHeader />
      <main className="flex-1 overflow-hidden p-6 flex flex-col">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Database size={20} />
            </div>
            <h1 className="text-2xl font-black tracking-tight leading-tight">
              {language === 'RU' ? 'Согласие на обработку данных' : 'Data Processing Consent'}
            </h1>
          </div>
          <p className="text-xs text-muted-foreground font-medium">
            {language === 'RU' ? 'Соответствие 152-ФЗ и GDPR' : 'GDPR & 152-FZ Compliance'}
          </p>
        </header>

        <ScrollArea className="flex-1 pr-4">
          <div className="prose prose-sm max-w-none space-y-6 text-foreground/80 leading-relaxed font-medium pb-12">
            {language === 'RU' ? (
              <>
                <p>Нажимая кнопку «Продолжить» при регистрации или используя Приложение, вы даете свое полное и осознанное согласие на автоматизированную обработку ваших персональных данных.</p>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">Что мы обрабатываем:</h2>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>ФИО (или псевдоним);</li>
                    <li>Контактный email или номер телефона;</li>
                    <li>Фотографии и био;</li>
                    <li>Технические параметры сессии.</li>
                  </ul>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">Цели обработки:</h2>
                  <p>Оказание услуг сервиса знакомств, подбор наиболее подходящих анкет, отправка уведомлений и улучшение качества работы продукта.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">Ваши права:</h2>
                  <p>Вы имеете право отозвать согласие в любой момент, удалив свой профиль в настройках Приложения. Мы храним ваши данные только до тех пор, пока это необходимо для функционирования вашего аккаунта.</p>
                </section>
              </>
            ) : (
              <>
                <p>By clicking "Continue" during registration or by using the Application, you give your full and informed consent to the automated processing of your personal data.</p>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">What we process:</h2>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Full name (or pseudonym);</li>
                    <li>Contact email or phone number;</li>
                    <li>Photos and bio;</li>
                    <li>Technical parameters of the session.</li>
                  </ul>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">Processing purposes:</h2>
                  <p>Providing dating services, selecting the most suitable profiles, sending notifications, and improving the quality of the product.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">Your rights:</h2>
                  <p>You have the right to withdraw your consent at any time by deleting your profile in the Application settings. We store your data only as long as necessary for your account to function.</p>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
