import { AppHeader } from "@/components/layout/app-header";
import { useLanguage } from "@/context/language-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck } from "lucide-react";

export default function PrivacyPolicyPage() {
  const { language } = useLanguage();

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <AppHeader />
      <main className="flex-1 overflow-hidden p-6 flex flex-col">
        <header className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <ShieldCheck size={20} />
            </div>
            <h1 className="text-2xl font-black tracking-tight leading-tight">
              {language === 'RU' ? 'Политика конфиденциальности' : 'Privacy Policy'}
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
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">1. Общие положения</h2>
                  <p>Настоящая Политика конфиденциальности определяет, как приложение SwiftMatch (далее — «Приложение») собирает, использует и защищает информацию о пользователях.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">2. Сбор информации</h2>
                  <p>Мы собираем информацию, которую вы предоставляете при регистрации и использовании Приложения:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Профильные данные (имя, возраст, пол, интересы, био);</li>
                    <li>Фотографии, загруженные вами в галерею;</li>
                    <li>Данные о местоположении для поиска людей рядом;</li>
                    <li>Технические данные (IP-адрес, тип устройства, версия ОС).</li>
                  </ul>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">3. Использование данных</h2>
                  <p>Ваши данные используются исключительно для:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Обеспечения работы алгоритмов подбора (мэтчинга);</li>
                    <li>Персонализации опыта использования Приложения;</li>
                    <li>Связи с вами (уведомления о новых мэтчах и сообщениях);</li>
                    <li>Улучшения безопасности и предотвращения мошенничества.</li>
                  </ul>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">4. Защита информации</h2>
                  <p>Мы используем современные протоколы шифрования и облачные технологии Firebase (Google Cloud) для обеспечения безопасности ваших данных. Доступ к вашим личным сообщениям имеет только вы и ваш собеседник.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">5. Хранение и удаление</h2>
                  <p>Вы можете в любой момент изменить или удалить свои данные через настройки профиля. При удалении аккаунта вся ваша личная информация безвозвратно удаляется из наших баз данных.</p>
                </section>
              </>
            ) : (
              <>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">1. General Provisions</h2>
                  <p>This Privacy Policy defines how the SwiftMatch application (hereinafter — "Application") collects, uses, and protects information about users.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">2. Information Collection</h2>
                  <p>We collect information that you provide during registration and use of the Application:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Profile data (name, age, gender, interests, bio);</li>
                    <li>Photos uploaded by you to the gallery;</li>
                    <li>Location data to find people nearby;</li>
                    <li>Technical data (IP address, device type, OS version).</li>
                  </ul>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">3. Use of Data</h2>
                  <p>Your data is used exclusively for:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Operation of matching algorithms;</li>
                    <li>Personalizing your Application experience;</li>
                    <li>Communicating with you (notifications about new matches and messages);</li>
                    <li>Improving security and preventing fraud.</li>
                  </ul>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">4. Information Protection</h2>
                  <p>We use modern encryption protocols and Firebase (Google Cloud) technologies to ensure the security of your data. Only you and your correspondent have access to your private messages.</p>
                </section>
                <section>
                  <h2 className="font-black text-foreground uppercase tracking-wider text-xs mb-2">5. Storage and Deletion</h2>
                  <p>You can change or delete your data at any time via profile settings. Upon account deletion, all your personal information is permanently removed from our databases.</p>
                </section>
              </>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}
