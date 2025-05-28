import { supabase } from './client';
import type { PageType, Page, BasePage } from '$lib/types';

// Get all pages for a user
export async function getPages(userId: string) {
  const { data, error } = await supabase
    .from('pages')
    .select('*')
    .eq('user_id', userId)
    .order('order_index', { ascending: true });

  return { data, error };
}

// Get a specific page by ID
export async function getPage(pageId: string) {
  const { data, error } = await supabase
    .from('pages')
    .select('*')
    .eq('id', pageId)
    .single();

  return { data, error };
}

// Create a new page
export async function createPage(
  userId: string,
  type: PageType,
  title?: string,
  initialContent?: any,
  parentId?: string
) {
  // Generate title based on type and count of existing pages
  let defaultTitle = title;

  if (!defaultTitle) {
    const { count } = await supabase
      .from('pages')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('type', type);

    defaultTitle = `${type.charAt(0).toUpperCase() + type.slice(1)} ${(count || 0) + 1}`;
  }

  // Determine the order index (put it at the end)
  const { data: lastPage } = await supabase
    .from('pages')
    .select('order_index')
    .eq('user_id', userId)
    .order('order_index', { ascending: false })
    .limit(1)
    .single();

  const orderIndex = lastPage ? lastPage.order_index + 1 : 0;

  // Initialize appropriate content structure
  const content = initialContent || (type === 'canvas'
    ? { objects: [], drawings: [] }
    : { strokes: [] });

  const { data, error } = await supabase
    .from('pages')
    .insert({
      title: defaultTitle,
      type,
      content,
      user_id: userId,
      parent_id: parentId || null,
      order_index: orderIndex
    })
    .select()
    .single();

  return { data, error };
}

// Update a page
export async function updatePage(pageId: string, updates: Partial<Page>) {
  const { data, error } = await supabase
    .from('pages')
    .update(updates)
    .eq('id', pageId)
    .select()
    .single();

  return { data, error };
}

// Update a page content
export async function updatePageContent(pageId: string, content: any) {
  const { data, error } = await supabase
    .from('pages')
    .update({ content, updated_at: new Date() })
    .eq('id', pageId)
    .select()
    .single();

  return { data, error };
}

// Delete a page
export async function deletePage(pageId: string) {
  // First check if this page is a parent to any other pages
  const { data: childPages } = await supabase
    .from('pages')
    .select('id')
    .eq('parent_id', pageId);

  if (childPages && childPages.length > 0) {
    // Update all child pages to have no parent
    await supabase
      .from('pages')
      .update({ parent_id: null })
      .eq('parent_id', pageId);
  }

  // Now delete the page
  const { error } = await supabase
    .from('pages')
    .delete()
    .eq('id', pageId);

  return { error };
}

// Reorder pages
export async function reorderPages(orderedPages: Array<{ id: string, order_index: number }>) {
  const { error } = await supabase.rpc('reorder_pages', { pages: orderedPages });
  return { error };
}

// Upload thumbnail for a page
export async function uploadThumbnail(pageId: string, thumbnailBlob: Blob) {
  const fileName = `${pageId}-${Date.now()}.png`;
  const filePath = `thumbnails/${fileName}`;

  /*

  // Upload to Supabase storage
  const { error: uploadError } = await supabase.storage
    .from('thumbnails')
    .upload(filePath, thumbnailBlob, {
      contentType: 'image/png',
      upsert: true
    });

  if (uploadError) {
    console.error('Error uploading thumbnail:', uploadError);
    return { error: uploadError };
  }

  // Get public URL
  const { data } = supabase.storage.from('thumbnails').getPublicUrl(filePath);

  // Update page with new thumbnail URL
  const { error: updateError } = await supabase
    .from('pages')
    .update({ thumbnail_url: data.publicUrl })
    .eq('id', pageId);

  return { url: data.publicUrl, error: updateError };
  */
}