// src/tools/woocommerce.ts
// WooCommerce REST API tools for product data (price, meta_data/ACF fields, stock, variations, etc.)
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { makeWordPressGenericRequest, logToFile } from '../wordpress.js';
import { z } from 'zod';

// --- Schema Definitions ---

const listWooProductsSchema = z.object({
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10, max 100)"),
  search: z.string().optional().describe("Search by product name or description"),
  sku: z.string().optional().describe("Filter by exact SKU"),
  slug: z.string().optional().describe("Filter by product slug"),
  status: z.string().optional().describe("Product status: publish, draft, pending, private"),
  category: z.string().optional().describe("Filter by category ID (comma-separated for multiple)"),
  tag: z.string().optional().describe("Filter by tag ID (comma-separated for multiple)"),
  type: z.enum(['simple', 'grouped', 'external', 'variable']).optional().describe("Product type filter"),
  featured: z.boolean().optional().describe("Filter featured products only"),
  on_sale: z.boolean().optional().describe("Filter on-sale products only"),
  min_price: z.string().optional().describe("Minimum price filter"),
  max_price: z.string().optional().describe("Maximum price filter"),
  stock_status: z.enum(['instock', 'outofstock', 'onbackorder']).optional().describe("Stock status filter"),
  orderby: z.string().optional().describe("Sort by: date, id, title, slug, price, popularity, rating"),
  order: z.enum(['asc', 'desc']).optional().describe("Sort order")
});

const getWooProductSchema = z.object({
  id: z.number().describe("Product ID")
});

const getWooProductVariationsSchema = z.object({
  product_id: z.number().describe("Parent product ID"),
  page: z.number().optional().describe("Page number (default 1)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10)")
});

const searchWooProductsSchema = z.object({
  search: z.string().describe("Search term (matches name, SKU, description)"),
  per_page: z.number().min(1).max(100).optional().describe("Items per page (default 10)")
});

// --- Type Definitions ---
type ListWooProductsParams = z.infer<typeof listWooProductsSchema>;
type GetWooProductParams = z.infer<typeof getWooProductSchema>;
type GetWooProductVariationsParams = z.infer<typeof getWooProductVariationsSchema>;
type SearchWooProductsParams = z.infer<typeof searchWooProductsSchema>;

// --- Helper: Format product data for readability ---
function formatProductSummary(product: any) {
  const meta: Record<string, any> = {};
  if (Array.isArray(product.meta_data)) {
    for (const m of product.meta_data) {
      // Skip internal WooCommerce meta keys (start with _)
      if (m.key && !m.key.startsWith('_')) {
        meta[m.key] = m.value;
      }
    }
  }

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    permalink: product.permalink,
    type: product.type,
    status: product.status,
    sku: product.sku,
    // Pricing
    price: product.price,
    regular_price: product.regular_price,
    sale_price: product.sale_price,
    price_html: product.price_html,
    on_sale: product.on_sale,
    // Description
    description: product.description,
    short_description: product.short_description,
    // Physical attributes
    weight: product.weight,
    dimensions: product.dimensions,
    // Stock
    stock_status: product.stock_status,
    stock_quantity: product.stock_quantity,
    manage_stock: product.manage_stock,
    // Categorization
    categories: product.categories,
    tags: product.tags,
    // Images
    images: product.images?.map((img: any) => ({
      id: img.id,
      src: img.src,
      name: img.name,
      alt: img.alt
    })),
    // Attributes (Size, Color, etc.)
    attributes: product.attributes,
    // Variations (for variable products)
    variations: product.variations,
    // ACF and custom meta fields (filtered — excludes internal _ prefixed keys)
    custom_meta: meta,
    // All meta_data (including internal, for completeness)
    meta_data_all: product.meta_data,
    // ACF fields (if ACF REST support is enabled, WooCommerce may include this)
    acf: product.acf || null,
    // Ratings
    average_rating: product.average_rating,
    rating_count: product.rating_count,
    total_sales: product.total_sales,
    // Related
    related_ids: product.related_ids,
    upsell_ids: product.upsell_ids,
    cross_sell_ids: product.cross_sell_ids,
    // Dates
    date_created: product.date_created,
    date_modified: product.date_modified,
  };
}

// --- Tool Definitions ---
export const wooCommerceTools: Tool[] = [
  {
    name: "list_woo_products",
    description: "List WooCommerce products with full product data including pricing (regular/sale price), SKU, stock status, meta_data (contains ACF custom fields like ingredients, volume, how_to_use), categories, tags, images, and attributes. Uses /wc/v3/products endpoint.",
    inputSchema: { type: "object", properties: listWooProductsSchema.shape }
  },
  {
    name: "get_woo_product",
    description: "Get a single WooCommerce product by ID with ALL details: pricing, full description, SKU, stock, weight, dimensions, all meta_data (ACF fields like ingredients, volume, how_to_use, price_krw), images, attributes, variations, ratings, and related products. Uses /wc/v3/products/{id} endpoint.",
    inputSchema: { type: "object", properties: getWooProductSchema.shape }
  },
  {
    name: "get_woo_product_variations",
    description: "Get all variations for a variable WooCommerce product. Each variation includes its own price, SKU, stock status, attributes (size, color), weight, dimensions, and meta_data.",
    inputSchema: { type: "object", properties: getWooProductVariationsSchema.shape }
  },
  {
    name: "search_woo_products",
    description: "Search WooCommerce products by name, SKU, or description. Returns full product data with pricing, meta_data (ACF custom fields), stock, and all details.",
    inputSchema: { type: "object", properties: searchWooProductsSchema.shape }
  }
];

// --- Handlers ---
export const wooCommerceHandlers = {
  list_woo_products: async (params: ListWooProductsParams) => {
    try {
      logToFile(`Listing WooCommerce products with params: ${JSON.stringify(params)}`);

      const response = await makeWordPressGenericRequest('GET', 'wc/v3/products', params);

      const products = Array.isArray(response)
        ? response.map(formatProductSummary)
        : response;

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(products, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error listing WooCommerce products: ${error.message}${error.response?.status === 401 ? '\n\nAuthentication failed. WooCommerce REST API may require separate consumer key/secret. Set WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET environment variables, or ensure your WordPress user has shop_manager/admin role.' : ''}${error.response?.status === 404 ? '\n\nWooCommerce REST API not found. Ensure WooCommerce plugin is installed and activated.' : ''}`
          }],
          isError: true
        }
      };
    }
  },

  get_woo_product: async (params: GetWooProductParams) => {
    try {
      logToFile(`Getting WooCommerce product ID: ${params.id}`);

      const response = await makeWordPressGenericRequest('GET', `wc/v3/products/${params.id}`);
      const formatted = formatProductSummary(response);

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify(formatted, null, 2)
          }],
          isError: false
        }
      };
    } catch (error: any) {
      return {
        toolResult: {
          content: [{
            type: 'text',
            text: `Error getting WooCommerce product: ${error.message}${error.response?.status === 404 ? '\n\nProduct not found or WooCommerce REST API not available.' : ''}`
          }],
          isError: true
        }
      };
    }
  },

  get_woo_product_variations: async (params: GetWooProductVariationsParams) => {
    try {
      logToFile(`Getting variations for product ID: ${params.product_id}`);

      const queryParams: any = {};
      if (params.page) queryParams.page = params.page;
      if (params.per_page) queryParams.per_page = params.per_page;

      const response = await makeWordPressGenericRequest(
        'GET',
        `wc/v3/products/${params.product_id}/variations`,
        queryParams
      );

      const variations = Array.isArray(response)
        ? response.map((v: any) => {
            const meta: Record<string, any> = {};
            if (Array.isArray(v.meta_data)) {
              for (const m of v.meta_data) {
                if (m.key && !m.key.startsWith('_')) {
                  meta[m.key] = m.value;
                }
              }
            }
            return {
              id: v.id,
              sku: v.sku,
              price: v.price,
              regular_price: v.regular_price,
              sale_price: v.sale_price,
              on_sale: v.on_sale,
              stock_status: v.stock_status,
              stock_quantity: v.stock_quantity,
              weight: v.weight,
              dimensions: v.dimensions,
              attributes: v.attributes,
              image: v.image,
              custom_meta: meta,
              meta_data_all: v.meta_data
            };
          })
        : response;

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              product_id: params.product_id,
              variations_count: Array.isArray(variations) ? variations.length : 0,
              variations
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
            text: `Error getting product variations: ${error.message}`
          }],
          isError: true
        }
      };
    }
  },

  search_woo_products: async (params: SearchWooProductsParams) => {
    try {
      logToFile(`Searching WooCommerce products: "${params.search}"`);

      const queryParams: any = {
        search: params.search,
        per_page: params.per_page || 10
      };

      const response = await makeWordPressGenericRequest('GET', 'wc/v3/products', queryParams);

      const products = Array.isArray(response)
        ? response.map(formatProductSummary)
        : response;

      return {
        toolResult: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              search_term: params.search,
              results_count: Array.isArray(products) ? products.length : 0,
              products
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
            text: `Error searching WooCommerce products: ${error.message}`
          }],
          isError: true
        }
      };
    }
  }
};
