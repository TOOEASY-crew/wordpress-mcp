// src/tools/acf.ts
// ACF (Advanced Custom Fields) tools using standard WordPress REST API
// Since ACF 5.11, ACF fields are exposed via standard /wp/v2/ endpoints (NOT a separate /acf/v3/ namespace).
// Requires: "Show in REST API" enabled per field group in ACF settings.
// See: https://www.advancedcustomfields.com/resources/wp-rest-api-integration/
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressRequest, logToFile } from '../wordpress.js';
import { z } from 'zod';

// --- Helper: Map content type to REST API base ---
function getContentEndpoint(contentType: string): string {
  const endpointMap: Record<string, string> = {
    'post': 'posts',
    'page': 'pages'
  };
  return endpointMap[contentType] || contentType;
}

// --- Schema Definitions ---

const getAcfFieldsSchema = z.object({
  content_type: z.string().describe("Content type slug (e.g., 'post', 'page', 'product', 'documentation')"),
  id: z.number().describe("Content ID to get ACF fields for")
});

const updateAcfFieldsSchema = z.object({
  content_type: z.string().describe("Content type slug (e.g., 'post', 'page', 'product')"),
  id: z.number().describe("Content ID to update ACF fields for"),
  fields: z.record(z.any()).describe("ACF field values as key-value pairs (e.g., { ingredients: 'Water, Glycerin...', volume: '100ml', how_to_use: 'Apply evenly...', price_krw: 35000 })")
});

const listAcfContentFieldsSchema = z.object({
  content_type: z.string().describe("Content type slug (e.g., 'post', 'page', 'product')"),
  per_page: z.number().min(1).max(100).optional().describe("Number of items to fetch (default 10)"),
  page: z.number().optional().describe("Page number (default 1)")
});

// --- Type Definitions ---
type GetAcfFieldsParams = z.infer<typeof getAcfFieldsSchema>;
type UpdateAcfFieldsParams = z.infer<typeof updateAcfFieldsSchema>;
type ListAcfContentFieldsParams = z.infer<typeof listAcfContentFieldsSchema>;

// --- Tool Definitions ---
export const acfTools: Tool[] = [
  {
    name: "get_acf_fields",
    description: "Get all ACF (Advanced Custom Fields) field values for a specific post, page, or custom post type. Returns fields like ingredients, volume, how_to_use, price_krw, etc. Uses standard WordPress REST API GET /wp/v2/{content_type}/{id} with acf_format=standard. Requires 'Show in REST API' enabled in ACF field group settings.",
    inputSchema: { type: "object", properties: getAcfFieldsSchema.shape }
  },
  {
    name: "update_acf_fields",
    description: "Update ACF field values for a specific post, page, or custom post type. Pass field names and values as key-value pairs. Uses standard WordPress REST API POST /wp/v2/{content_type}/{id} with { acf: { ... } } payload.",
    inputSchema: { type: "object", properties: updateAcfFieldsSchema.shape }
  },
  {
    name: "list_acf_content_fields",
    description: "List ACF field values for multiple items of a content type at once. Useful for bulk scanning all products' ACF fields (ingredients, volume, etc.). Returns only id and acf data for each item, minimizing response size.",
    inputSchema: { type: "object", properties: listAcfContentFieldsSchema.shape }
  }
];

// --- Handlers ---
export const acfHandlers = {
  get_acf_fields: async (params: GetAcfFieldsParams) => {
    try {
      const endpoint = getContentEndpoint(params.content_type);
      logToFile(`Getting ACF fields for ${params.content_type} ID: ${params.id}`);

      // Use standard WP REST API with _fields=id,acf to only return ACF data
      // acf_format=standard applies ACF's full formatting (e.g., expanded image data)
      const response = await makeWordPressRequest(
        'GET',
        `${endpoint}/${params.id}`,
        {
          _fields: 'id,title,acf',
          acf_format: 'standard'
        }
      );

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content_type: params.content_type,
              content_id: response?.id || params.id,
              title: response?.title?.rendered || null,
              acf_fields: response?.acf || null
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      const status = error.response?.status;
      let hint = '';
      if (status === 404) {
        hint = '\n\nContent not found. Verify the content_type and id are correct.';
      } else if (status === 401 || status === 403) {
        hint = '\n\nAuthentication/permission error. Ensure the WordPress user has read permissions.';
      }

      // Check if acf key is missing from response (ACF not configured for REST)
      const responseData = error.response?.data;
      if (responseData && !responseData.acf) {
        hint += '\n\nNote: If "acf" key is not in the response, ensure "Show in REST API" is enabled in ACF field group settings (ACF → Field Groups → [Group] → Settings → Show in REST API).';
      }

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error getting ACF fields: ${error.message}${hint}`
          }],
          isError: true
        }
      };
    }
  },

  update_acf_fields: async (params: UpdateAcfFieldsParams) => {
    try {
      const endpoint = getContentEndpoint(params.content_type);
      logToFile(`Updating ACF fields for ${params.content_type} ID: ${params.id}`);
      logToFile(`Fields: ${JSON.stringify(params.fields)}`);

      // Standard WP REST API: POST /wp/v2/{type}/{id} with { acf: { field: value } }
      // See: https://www.advancedcustomfields.com/resources/wp-rest-api-integration/
      const response = await makeWordPressRequest(
        'POST',
        `${endpoint}/${params.id}`,
        { acf: params.fields }
      );

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content_type: params.content_type,
              content_id: response?.id || params.id,
              updated: true,
              acf_fields: response?.acf || null
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      const status = error.response?.status;
      let hint = '';
      if (status === 404) {
        hint = '\n\nContent not found. Verify the content_type and id are correct.';
      } else if (status === 401 || status === 403) {
        hint = '\n\nPermission denied. Ensure the WordPress user has edit permissions for this content.';
      }

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error updating ACF fields: ${error.message}${hint}`
          }],
          isError: true
        }
      };
    }
  },

  list_acf_content_fields: async (params: ListAcfContentFieldsParams) => {
    try {
      const endpoint = getContentEndpoint(params.content_type);
      const queryParams: any = {
        per_page: params.per_page || 10,
        page: params.page || 1,
        _fields: 'id,title,slug,acf',
        acf_format: 'standard'
      };

      logToFile(`Listing ACF fields for ${params.content_type} (page ${queryParams.page}, per_page ${queryParams.per_page})`);

      const response = await makeWordPressRequest('GET', endpoint, queryParams);

      // Format: extract only id, title, and acf from each item
      const items = Array.isArray(response)
        ? response.map((item: any) => ({
            id: item.id,
            title: item.title?.rendered || null,
            slug: item.slug || null,
            acf: item.acf || null
          }))
        : response;

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content_type: params.content_type,
              page: queryParams.page,
              per_page: queryParams.per_page,
              items_count: Array.isArray(items) ? items.length : 0,
              items
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error listing ACF content fields: ${error.message}`
          }],
          isError: true
        }
      };
    }
  }
};
