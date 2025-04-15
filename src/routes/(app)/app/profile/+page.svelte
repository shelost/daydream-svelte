<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gsap } from 'gsap';
  import { user, profile } from '$lib/stores/appStore';
  import { supabase } from '$lib/supabase/client';
  import Sidebar from '$lib/components/Sidebar.svelte';

  let loading = false;
  let saving = false;
  let error = '';
  let success = '';

  // Form data
  let fullName = '';
  let avatarUrl = '';
  let avatarFile: File | null = null;
  let avatarPreview = '';

  onMount(() => {
    if (!$user) {
      goto('/');
      return;
    }

    // Initialize form with current profile data
    if ($profile) {
      fullName = $profile.full_name || '';
      avatarUrl = $profile.avatar_url || '';
      avatarPreview = avatarUrl;
    }

    // Animate the content
    gsap.from('.profile-card', {
      y: 20,
      opacity: 0,
      duration: 0.5,
      ease: "power2.out"
    });
  });

  // Handle file upload
  function handleFileChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target.files || target.files.length === 0) {
      avatarFile = null;
      avatarPreview = avatarUrl;
      return;
    }

    const file = target.files[0];
    avatarFile = file;

    // Create a preview
    const reader = new FileReader();
    reader.onload = (e) => {
      avatarPreview = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }

  // Save profile changes
  async function saveProfile() {
    if (!$user) {
      error = 'You must be logged in to update your profile';
      return;
    }

    if (!fullName.trim()) {
      error = 'Please enter your name';
      return;
    }

    error = '';
    success = '';
    saving = true;

    try {
      let newAvatarUrl = avatarUrl;

      // Upload new avatar if provided
      if (avatarFile) {
        const fileExt = avatarFile.name.split('.').pop();
        const fileName = `${$user.id}-${Math.random()}.${fileExt}`;
        const filePath = `avatars/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('profiles')
          .upload(filePath, avatarFile);

        if (uploadError) {
          throw new Error(`Error uploading avatar: ${uploadError.message}`);
        }

        const { data } = supabase.storage.from('profiles').getPublicUrl(filePath);
        newAvatarUrl = data.publicUrl;
      }

      // Update profile in database
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          avatar_url: newAvatarUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', $user.id);

      if (updateError) {
        throw new Error(`Error updating profile: ${updateError.message}`);
      }

      // Update local profile state
      if ($profile) {
        profile.set({
          ...$profile,
          full_name: fullName,
          avatar_url: newAvatarUrl,
          updated_at: new Date().toISOString()
        });
      }

      success = 'Profile updated successfully';
      avatarUrl = newAvatarUrl;

      // Animate success message
      const successElement = document.querySelector('.success-message');
      if (successElement) {
        gsap.from(successElement, {
          y: -10,
          opacity: 0,
          duration: 0.3,
          ease: "power2.out"
        });
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      error = err instanceof Error ? err.message : 'Failed to update profile';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>User Profile - Daydream</title>
</svelte:head>

<div class="profile-layout">

  <div class="profile-main">
    <div class="profile-header">
      <h1>User Profile</h1>
    </div>

    <div class="profile-content">
      <div class="profile-card">
        <div class="avatar-section">
          <div class="avatar-preview" style="background-image: url('{avatarPreview || 'https://via.placeholder.com/150'}')" />
          <label class="avatar-upload-label">
            Change Avatar
            <input type="file" accept="image/*" on:change={handleFileChange} />
          </label>
        </div>

        <div class="profile-form">
          <div class="form-group">
            <label for="fullName">Full Name</label>
            <input
              id="fullName"
              type="text"
              bind:value={fullName}
              placeholder="Your name"
            />
          </div>

          <div class="form-group">
            <label for="email">Email (read-only)</label>
            <input
              id="email"
              type="email"
              value={$user?.email || ''}
              readonly
            />
          </div>

          {#if error}
            <div class="error-message">{error}</div>
          {/if}

          {#if success}
            <div class="success-message">{success}</div>
          {/if}

          <button
            class="save-button"
            on:click={saveProfile}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style lang="scss">
  .profile-layout {
    display: flex;
    height: 100vh;
    width: 100%;
    overflow: hidden;
  }

  .profile-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .profile-header {
    background-color: $titlebar-bg;
    border-bottom: 1px solid $border-color;
    padding: 1rem 2rem;

    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0;
    }
  }

  .profile-content {
    padding: 2rem;
    max-width: 800px;
    margin: 0 auto;
    width: 100%;
  }

  .profile-card {
    background-color: $card-bg;
    border-radius: $border-radius-lg;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    padding: 2rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;

    @media (min-width: 768px) {
      flex-direction: row;
    }
  }

  .avatar-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .avatar-preview {
    width: 150px;
    height: 150px;
    border-radius: 50%;
    background-size: cover;
    background-position: center;
    border: 3px solid $primary-color;
  }

  .avatar-upload-label {
    cursor: pointer;
    padding: 0.5rem 1rem;
    background-color: $primary-color;
    color: white;
    border-radius: $border-radius-sm;
    font-size: 0.9rem;
    transition: all $transition-fast;

    &:hover {
      background-color: darken($primary-color, 10%);
    }

    input {
      display: none;
    }
  }

  .profile-form {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    label {
      font-size: 0.9rem;
      font-weight: 500;
      color: rgba($text-color, 0.8);
    }

    input {
      padding: 0.75rem;
      border: 1px solid $border-color;
      border-radius: $border-radius-md;
      font-size: 1rem;
      outline: none;
      transition: border-color $transition-fast;

      &:focus {
        border-color: $primary-color;
      }

      &[readonly] {
        background-color: rgba($text-color, 0.05);
        cursor: not-allowed;
      }
    }
  }

  .error-message {
    padding: 0.75rem;
    background-color: rgba($error-color, 0.1);
    color: $error-color;
    border-radius: $border-radius-sm;
    font-size: 0.9rem;
  }

  .success-message {
    padding: 0.75rem;
    background-color: rgba($success-color, 0.1);
    color: $success-color;
    border-radius: $border-radius-sm;
    font-size: 0.9rem;
  }

  .save-button {
    padding: 0.75rem 1.5rem;
    background-color: $primary-color;
    color: white;
    border: none;
    border-radius: $border-radius-md;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all $transition-fast;
    margin-top: 1rem;
    align-self: flex-start;

    &:hover:not(:disabled) {
      background-color: darken($primary-color, 10%);
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }
</style>