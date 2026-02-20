// src/tools/acf.ts
// ACF (Advanced Custom Fields) REST API tools
// Uses /wp-json/acf/v3/ endpoints (requires ACF 5.11+ with REST API enabled)
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressGenericRequest, logToFile } from '../wordpress.js';
import { z } from 'zod';

// --- Helper: Map content type to REST API base ---
function getAcfEndpointBase(contentType: string): string {
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

const getAcfOptionsSchema = z.object({
  field_name: z.string().optional().describe("Specific ACF options field name to retrieve. If omitted, returns all options page fields.")
});

const listAcfContentFieldsSchema = z.object({
  content_type: z.string().describe("Content type slug (e.g., 'post', 'page', 'product')"),
  per_page: z.number().min(1).max(100).optional().describe("Number of items to fetch (default 10)"),
  page: z.number().optional().describe("Page number (default 1)")
});

// --- Type Definitions ---
type GetAcfFieldsParams = z.infer<typeof getAcfFieldsSchema>;
type UpdateAcfFieldsParams = z.infer<typeof updateAcfFieldsSchema>;
type GetAcfOptionsParams = z.infer<typeof getAcfOptionsSchema>;
type ListAcfContentFieldsParams = z.infer<typeof listAcfContentFieldsSchema>;

// --- Tool Definitions ---
export const acfTools: Tool[] = [
  {
    name: "get_acf_fields",
    description: "Get all ACF (Advanced Custom Fields) field values for a specific post, page, or custom post type. Returns fields like ingredients, volume, how_to_use, price_krw, etc. Uses the dedicated ACF REST API endpoint /acf/v3/{content_type}/{id}.",
    inputSchema: { type: "object", properties: getAcfFieldsSchema.shape }
  },
  {
    name: "update_acf_fields",
    description: "Update ACF field values for a specific post, page, or custom post type. Pass field names and values as key-value pairs. Uses PUT /acf/v3/{content_type}/{id}.",
    inputSchema: { type: "object", properties: updateAcfFieldsSchema.shape }
  },
  {
    name: "get_acf_options",
    description: "Get ACF Options page field values. Options pages store global settings (e.g., site-wide pricing rules, global ingredients lists). Uses /acf/v3/options/{field_name} or /acf/v3/options for all fields.",
    inputSchema: { type: "object", properties: getAcfOptionsSchema.shape }
  },
  {
    name: "list_acf_content_fields",
    description: "List ACF field values for multiple items of a content type at once. Useful for bulk scanning all products' ACF fields (ingredients, volume, etc.). Returns ACF data for each item.",
    inputSchema: { type: "object", properties: listAcfContentFieldsSchema.shape }
  }
];

// --- Handlers ---
export const acfHandlers = {
  get_acf_fields: async (params: GetAcfFieldsParams) => {
    try {
      const base = getAcfEndpointBase(params.content_type);
      logToFile(`Getting ACF fields for ${params.content_type} ID: ${params.id}`);

      const response = await makeWordPressGenericRequest(
        'GET',
        `acf/v3/${base}/${params.id}`
      );

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content_type: params.content_type,
              content_id: params.id,
              acf_fields: response?.acf || response
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      const status = error.response?.status;
      let hint = '';
      if (status === 404) {
        hint = '\n\nACF REST API endpoint not found. Possible causes:\n1. ACF plugin is not installed or activated\n2. ACF REST API is not enabled (ACF → Settings → Enable REST API)\n3. The content type or ID does not exist\n\nAlternative: Use get_content with content_type parameter — ACF fields may appear in the "acf" key if ACF REST support is enabled globally.';
      } else if (status === 401 || status === 403) {
        hint = '\n\nAuthentication/permission error. Ensure the WordPress user has permission to read ACF fields.';
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
      const base = getAcfEndpointBase(params.content_type);
      logToFile(`Updating ACF fields for ${params.content_type} ID: ${params.id}`);
      logToFile(`Fields: ${JSON.stringify(params.fields)}`);

      const response = await makeWordPressGenericRequest(
        'PUT',
        `acf/v3/${base}/${params.id}`,
        { acf: params.fields }
      );

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content_type: params.content_type,
              content_id: params.id,
              updated: true,
              acf_fields: response?.acf || response
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      const status = error.response?.status;
      let hint = '';
      if (status === 404) {
        hint = '\n\nACF REST API endpoint not found. Ensure ACF plugin is installed and REST API is enabled.';
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

  get_acf_options: async (params: GetAcfOptionsParams) => {
    try {
      const endpoint = params.field_name
        ? `acf/v3/options/${params.field_name}`
        : 'acf/v3/options';

      logToFile(`Getting ACF options: ${endpoint}`);

      const response = await makeWordPressGenericRequest('GET', endpoint);

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              field_name: params.field_name || '(all options)',
              options: response?.acf || response
            }, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      const status = error.response?.status;
      let hint = '';
      if (status === 404) {
        hint = '\n\nACF Options page REST endpoint not found. Ensure:\n1. ACF Pro is installed (Options pages require ACF Pro)\n2. Options page has been registered\n3. ACF REST API is enabled';
      }

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error getting ACF options: ${error.message}${hint}`
          }],
          isError: true
        }
      };
    }
  },

  list_acf_content_fields: async (params: ListAcfContentFieldsParams) => {
    try {
      const base = getAcfEndpointBase(params.content_type);
      const queryParams: any = {
        per_page: params.per_page || 10,
        page: params.page || 1
      };

      logToFile(`Listing ACF fields for ${params.content_type} (page ${queryParams.page}, per_page ${queryParams.per_page})`);

      const response = await makeWordPressGenericRequest(
        'GET',
        `acf/v3/${base}`,
        queryParams
      );

      // Format: each item should show its ID and ACF fields
      const items = Array.isArray(response)
        ? response.map((item: any) => ({
            id: item.id,
            acf: item.acf || item
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
