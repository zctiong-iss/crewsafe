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
];