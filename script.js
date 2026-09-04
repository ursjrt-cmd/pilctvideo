import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ==========================================
// 1. SUPABASE INITIALIZATION
// ==========================================
const SUPABASE_URL = 'https://ztrujafqslzcbgskovkb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0cnVqYWZxc2x6Y2Jnc2tvdmtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MDgwNTgsImV4cCI6MjEwNDA4NDA1OH0.sbTgauhfGojttbI4YMhePMc69pV__HVHeX9aC8O-d8k';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// 2. AUTHENTICATION
// ==========================================

export async function signUp(email, password, username, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username,
        full_name: fullName
      }
    }
  });
  if (error) throw error;
  
  // Note: It's best practice to use a Supabase Database Trigger to insert into the `profiles` table 
  // automatically on new user signup. If you don't have a trigger, uncomment the following lines:
  /*
  if (data.user) {
    await supabase.from('profiles').insert([
      { id: data.user.id, username: username, full_name: fullName }
    ]);
  }
  */
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ==========================================
// 3. MEDIA FEED & METADATA
// ==========================================

export async function fetchMediaFeed() {
  // Joins media with profiles (author info), likes, and shares
  const { data, error } = await supabase
    .from('media')
    .select(`
      *,
      profiles (username, full_name, avatar_url),
      likes (user_id),
      shares (id)
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// ==========================================
// 4. FILE UPLOAD (MEDIA & POSTERS)
// ==========================================

export async function uploadMediaItem({ title, description, category, mediaType, mediaFile, posterFile }) {
  const { data: { session }, error: authError } = await supabase.auth.getSession();
  if (authError || !session) throw new Error("User must be logged in to upload.");
  
  const userId = session.user.id;
  const timestamp = Date.now();
  
  let mediaUrl = '';
  let posterUrl = '';

  // 1. Upload Media File (Video/Audio)
  const mediaExt = mediaFile.name.split('.').pop();
  const mediaPath = `${userId}/${timestamp}_media.${mediaExt}`;
  
  const { error: mediaUploadError } = await supabase.storage
    .from('media_files')
    .upload(mediaPath, mediaFile);
    
  if (mediaUploadError) throw mediaUploadError;
  
  const { data: mediaPublicData } = supabase.storage
    .from('media_files')
    .getPublicUrl(mediaPath);
  mediaUrl = mediaPublicData.publicUrl;

  // 2. Upload Poster File (if provided)
  if (posterFile) {
    const posterExt = posterFile.name.split('.').pop();
    const posterPath = `${userId}/${timestamp}_poster.${posterExt}`;
    
    const { error: posterUploadError } = await supabase.storage
      .from('images')
      .upload(posterPath, posterFile);
      
    if (posterUploadError) throw posterUploadError;
    
    const { data: posterPublicData } = supabase.storage
      .from('images')
      .getPublicUrl(posterPath);
    posterUrl = posterPublicData.publicUrl;
  }

  // 3. Insert Database Record
  const { data, error: dbError } = await supabase
    .from('media')
    .insert([{
      user_id: userId,
      title,
      description,
      category,
      media_type: mediaType,
      media_url: mediaUrl,
      poster_url: posterUrl,
      views_count: 0
    }]);

  if (dbError) throw dbError;
  return data;
}

// ==========================================
// 5. USER PROFILE MANAGEMENT
// ==========================================

export async function updateUserProfile(userId, { bio, avatarFile, bannerFile }) {
  let updates = { id: userId, updated_at: new Date() };
  if (bio !== undefined) updates.bio = bio;

  const timestamp = Date.now();

  // Upload Avatar
  if (avatarFile) {
    const avatarPath = `${userId}/${timestamp}_avatar.${avatarFile.name.split('.').pop()}`;
    const { error: avatarUploadError } = await supabase.storage
      .from('images')
      .upload(avatarPath, avatarFile, { upsert: true });
    
    if (avatarUploadError) throw avatarUploadError;
    
    const { data: avatarUrlData } = supabase.storage.from('images').getPublicUrl(avatarPath);
    updates.avatar_url = avatarUrlData.publicUrl;
  }

  // Upload Banner
  if (bannerFile) {
    const bannerPath = `${userId}/${timestamp}_banner.${bannerFile.name.split('.').pop()}`;
    const { error: bannerUploadError } = await supabase.storage
      .from('images')
      .upload(bannerPath, bannerFile, { upsert: true });
    
    if (bannerUploadError) throw bannerUploadError;
    
    const { data: bannerUrlData } = supabase.storage.from('images').getPublicUrl(bannerPath);
    updates.banner_url = bannerUrlData.publicUrl; // Requires banner_url column in profiles
  }

  // Update Profiles Table
  const { error } = await supabase
    .from('profiles')
    .upsert(updates);

  if (error) throw error;
}

// ==========================================
// 6. INTERACTIONS (LIKES & SHARES)
// ==========================================

export async function toggleLikeMedia(mediaId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Must be logged in to like.");
  const userId = session.user.id;

  // Check if like exists
  const { data: existingLike, error: fetchError } = await supabase
    .from('likes')
    .select('*')
    .eq('user_id', userId)
    .eq('media_id', mediaId)
    .single();

  if (existingLike) {
    // Unlike
    const { error } = await supabase
      .from('likes')
      .delete()
      .eq('user_id', userId)
      .eq('media_id', mediaId);
    if (error) throw error;
  } else {
    // Like
    const { error } = await supabase
      .from('likes')
      .insert([{ user_id: userId, media_id: mediaId }]);
    if (error) throw error;
  }
}

export async function trackShareMedia(mediaId) {
  // Simple table to keep a count/record of shares
  const { error } = await supabase
    .from('shares')
    .insert([{ media_id: mediaId }]);
  
  if (error) throw error;
}