import { adHref, adsFor } from "@/lib/ads";
import { AdPopup } from "./AdPopup";
import { BannerRotator } from "./BannerRotator";

/** The strip under the menu. Several banners take turns. */
export async function AdBanner() {
  const ads = await adsFor("banner");
  if (!ads.length) return null;
  return (
    <section className="ad-banner" aria-label="โฆษณา">
      <BannerRotator count={ads.length}>
        {ads.map((ad) => (
          <a key={ad.id} href={adHref(ad)} target="_blank" rel="sponsored noopener" className="ad-banner-link" title={ad.title}>
            <picture>
              {ad.mobileImageUrl && <source media="(max-width: 640px)" srcSet={ad.mobileImageUrl} />}
              <img src={ad.imageUrl} alt={ad.title} />
            </picture>
            <span className="ad-chip">โฆษณา</span>
          </a>
        ))}
      </BannerRotator>
    </section>
  );
}

/** Up to three shop cards on the home page. */
export async function AdCards() {
  const ads = (await adsFor("card")).slice(0, 3);
  if (!ads.length) return null;
  return (
    <section className="ad-cards mt" aria-label="โฆษณา">
      {ads.map((ad) => (
        <a key={ad.id} href={adHref(ad)} target="_blank" rel="sponsored noopener" className="ad-card card">
          <img src={ad.imageUrl} alt="" />
          <span className="ad-card-title">{ad.title}</span>
          <span className="ad-chip">โฆษณา</span>
        </a>
      ))}
    </section>
  );
}

/** The newest popup ad, if any. */
export async function AdPopupSlot() {
  const [ad] = await adsFor("popup");
  if (!ad) return null;
  return <AdPopup id={ad.id} href={adHref(ad)} image={ad.imageUrl} title={ad.title} />;
}
