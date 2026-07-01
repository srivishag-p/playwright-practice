@ui @github
Feature: GitHub Login and Profile Management
  As a GitHub user
  I want to log in and update my profile name
  So that my profile reflects the correct display name

  @smoke @positive
  Scenario: Successful GitHub login
    Given I am on the GitHub login page
    When I sign in to GitHub using environment credentials
    Then I should be logged in to GitHub

  @positive
  Scenario: Update GitHub profile name after login
    Given I am on the GitHub login page
    When I sign in to GitHub using environment credentials
    Then I should be logged in to GitHub
    When I open the profile menu
    And I navigate to my GitHub profile
    And I click edit profile
    And I change my profile name to "Srivishag"
    And I save the profile changes
    Then my GitHub profile name should be updated
