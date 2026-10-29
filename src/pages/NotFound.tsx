import { Link } from "react-router-dom";
import { useLanguage } from "@/context/language-context";

const NotFound = () => {
  const { t } = useLanguage();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">{t("notfound.title")}</p>
        <p className="mb-4 text-sm text-muted-foreground">{t("notfound.text")}</p>
        <Link to="/" className="text-primary underline hover:text-primary/90">
          {t("notfound.home")}
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
