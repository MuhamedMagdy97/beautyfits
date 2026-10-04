import { localeFromAcceptLanguage } from "@/server/http/locale";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { getLocationsService } from "@/server/modules/locations/locations-service";

/** GET /api/v1/locations — active governorates and their active areas (public, R32). */
export const GET = withApi(async (request, api) => {
  const locale = localeFromAcceptLanguage(request.headers.get("accept-language"));
  return ok(api.requestId, await getLocationsService().listPublic(locale));
});
