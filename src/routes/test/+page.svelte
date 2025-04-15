<script>
  import { goto } from '$app/navigation';

  const handleLogin = () => {
    goto('/auth/login');
  };

  const handleSignup = () => {
    goto('/auth/signup');
  };
</script>

<main>
  <h1>Test Page</h1>
  <div>
    <button class="login-button" on:click={handleLogin}>
      Log In
    </button>
    <button class="signup-button" on:click={handleSignup}>
      Sign Up
    </button>
  </div>
</main>

<style>
  main {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 20px;
  }

  div {
    display: flex;
    gap: 10px;
  }

  button {
    padding: 10px 20px;
    font-size: 16px;
    border-radius: 8px;
    cursor: pointer;
  }

  .login-button {
    background-color: transparent;
    color: #0077ff;
    border: 1px solid #0077ff;
  }

  .signup-button {
    background-color: #0077ff;
    color: white;
    border: none;
  }
</style>