/** @author Tang Chee Seng (with assistance from Claude) */

import { http, HttpResponse } from "msw";

const BASE = "http://localhost:8080";   // matching VITE_API_BASE_URL stubbed in setup.ts

/** Error body text. Mirrors ErrorResponse.java. */
const errorBody = (error: string, message: string) => ({
  error,
  message,
  requestId: "test-request-id",
});

export const handlers = [

  // Shifts list for the site. One PLANNED shift whose sole assignment resolves to "Worker One".
  http.get(`${BASE}/api/v1/sites/:siteId/shifts`, ({ params }) =>
    HttpResponse.json([
      {
        id: "shift-1",
        siteId: params.siteId,
        startsAt: "2026-08-10T00:00:00Z",   // 08:00 SGT 10 Aug → renders "10 Aug"
        endsAt: "2026-08-10T08:00:00Z",
        status: "PLANNED",
        assignments: [
          {
            id: "a-1",
            workerId: "00000000-0000-4000-8000-000000000001", // = "Worker One"
            intensity: "MODERATE",
            taskName: "Grass Cutting",
            acclimatisationDay: 2,
          },
        ],
      },
    ]),
  ),

  http.post(`${BASE}/api/v1/sites/:siteId/shifts`, async ({ params, request }) => {
    const { siteId } = params;
    const body = await request.json() as {
        startsAt: string; endsAt: string
    }

    if (siteId === "unauthorised-worksite")
        return HttpResponse.json(errorBody(
            "Forbidden", 
            "Access denied. You are not accessing your assigned worksite."), 
            {
            status: 403
            }
        );
    
    if (new Date(body.endsAt) <= new Date(body.startsAt)){
    return HttpResponse.json(errorBody(
        "Bad Request",
        "Invalid values for assignment start and end time. The end time cannot be before the start time."),
        {
            status: 400
        }
        );
    }
    
    return HttpResponse.json(
        { id: "shift-1", 
            siteId, 
            status: "PLANNED", ...body }, { status: 201 });
    }),

  // The picker's source.
  http.get(`${BASE}/api/v1/sites/:siteId/workers`, () =>
    HttpResponse.json([
      { id: "00000000-0000-4000-8000-000000000001", displayName: "Worker One" },
      { id: "00000000-0000-4000-8000-000000000002", displayName: "Worker Two" },
    ]),
  ),

  http.get(`${BASE}/api/v1/me`, () =>
  HttpResponse.json({
    id: "u-1",
    username: "supervisor",
    displayName: "Supervisor",
    role: "SUPERVISOR",
    siteIds: ["site-1"],
  }),
),

http.get(`${BASE}/api/v1/sites`, () =>
  HttpResponse.json([
    { id: "site-1", name: "Bishan Park Landscaping", latitude: 1.3622, longitude: 103.8455, timezone: "Asia/Singapore" },
    { id: "site-2", name: "NUS Campus Maintenance",  latitude: 1.2966, longitude: 103.7764, timezone: "Asia/Singapore" },
  ]),
)
];