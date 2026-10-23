import type { LegalDocument } from "@/components/legal-page";

export const privacy: LegalDocument = {
  title: "Privacy policy.",
  summary: "How Grove handles your notes and personal information.",
  sections: [
    {
      id: "scope",
      title: "Who we are",
      content: (
        <>
          <p>
            Grove is a developer tool operated by Bramble Labs Inc. This policy
            covers usegrove.cloud, our hosted Grove service, and related
            support. Contact <a href="mailto:grove@mawa.dev">grove@mawa.dev</a>{" "}
            for privacy questions or requests.
          </p>
          <p>
            If you run Grove yourself, you control that deployment and its
            providers, retention, and users. This policy describes our hosted
            service; a separate operator is responsible for their own
            deployment. Your connected agents and model providers have their own
            privacy practices.
          </p>
        </>
      ),
    },
    {
      id: "information",
      title: "Information Grove handles",
      content: (
        <>
          <ul>
            <li>
              <strong>Account information:</strong> your authentication
              identifier, email and available profile details, sign-in/session
              information, and account lifecycle state.
            </li>
            <li>
              <strong>Memory content:</strong> text you or your agents save,
              preferences, decisions, facts, solutions, task handoffs, project
              identities, tags, generated summaries, revisions, timestamps, and
              archive/deletion state. Attachments include images, original
              recordings and saved transcripts; optional speech also creates
              temporary machine suggestions and generated audio.
            </li>
            <li>
              <strong>Search information:</strong> recall queries and the memory
              content processed to produce search results, full-text indexes,
              and numerical embeddings.
            </li>
            <li>
              <strong>Connections:</strong> agent/client names, approved scopes,
              access grants, API-key records and protected credential material,
              revocations, and connection activity needed to operate and secure
              access.
            </li>
            <li>
              <strong>Operational information:</strong> request and error
              metadata, network addresses processed by infrastructure, security
              and recovery records, and correspondence you send us.
            </li>
          </ul>
          <p>
            Do not save passwords, API secrets, or information you are not
            permitted to share. A memory can include personal information about
            you or others if you put it in the text.
          </p>
        </>
      ),
    },
    {
      id: "purposes",
      title: "How we use information",
      content: (
        <>
          <p>
            We use information to authenticate accounts, store and revise
            memories, retrieve relevant context, manage project scopes and
            connections, provide exports and deletion, respond to support,
            maintain reliability, and investigate misuse. Where a legal basis is
            required, this can include providing the service you request,
            legitimate operational and security interests where permitted,
            consent for optional processing, and legal obligations.
          </p>
          <p>
            Grove&apos;s tools save selected context rather than a continuous
            transcript of every conversation. Optional client hooks can retrieve
            a bounded profile or handoff. What is sent depends on the agent,
            tools, and configuration you choose.
          </p>
        </>
      ),
    },
    {
      id: "access",
      title: "Your agents and your controls",
      content: (
        <>
          <p>
            Hosted memories belong to your account. Connections require
            authentication and the scope you approve. You can inspect memories,
            correct them, view revisions, archive or restore them, delete them,
            and revoke connections in Your Grove.
          </p>
          <p>
            When an agent recalls a memory, the selected content is sent to that
            agent. Its AI provider may then process the content under its own
            terms. Revoking access or deleting a memory cannot retract copies
            already delivered to an agent, conversation history, export, or
            another service.
          </p>
          <p>
            Access controls protect account boundaries. Grove is not end-to-end
            encrypted against its operator: the service must process readable
            memory text to store and retrieve it.
          </p>
        </>
      ),
    },
    {
      id: "providers",
      title: "Providers and other recipients",
      content: (
        <>
          <p>
            We use providers for sign-in, hosting, database storage and
            recovery, analytics, diagnostics and domain services. These
            providers process information needed to perform their roles. Our AI
            providers process query and memory text for embeddings and
            classification, and generate titles, tags and source-linked
            summaries from selected memories. You can disable organization and
            summaries in Settings. If you enable speech, OpenAI receives
            original audio when you choose Transcribe, or saved note text when
            you prepare read-aloud audio. These independent features default off
            and never run on anonymous shared reads. Generated speech is
            temporary; saved transcripts follow your note history. OpenAI
            applies its own data controls and retention policies. Turning a
            feature off cannot recall data already sent.
          </p>
          <p>
            Authorized support and operations personnel may access information
            where needed to provide support, investigate an incident, or comply
            with law. We may disclose information for lawful requests,
            protection of rights, professional advice, or a business transfer
            subject to applicable protections. We do not sell memory content or
            use it for advertising.
          </p>
          <p>
            Providers may process information outside your country. Applicable
            transfer protections and local legal rights continue to apply;
            contact us for information relevant to your situation.
          </p>
        </>
      ),
    },
    {
      id: "website",
      title: "Website analytics and local storage",
      content: (
        <>
          <p>
            With your permission, advertising partners use cookies and device
            information, including IP addresses and public-page visits, to
            measure advertising and build audiences for ads on other sites.
            Advertising runs only on public marketing pages after you accept
            advertising cookies. Cookie settings in the footer lets you choose
            analytics and advertising separately, or turn both off. An essential
            first-party cookie stores your choice for 180 days. Optional
            analytics, diagnostics and advertising stay off until you agree.
            Global Privacy Control and Do Not Track prevent them from loading.
            Disabling tracking refreshes the page to unload active tags. Tags
            are excluded from sign-in, private workspaces and shared-note pages;
            account emails, notes and prompts are not configured as advertising
            data.
          </p>
          <p>
            With your permission, website analytics measures page views,
            installation copies, referral links and bounded operation outcomes.
            A random browser identity is stored locally, without account
            identification or person profiles. Account changes reset it. URLs
            omit queries, fragments and private route IDs. Diagnostics receives
            sanitized errors, sampled traces, timing metrics and operation logs.
            Note text, prompts, responses, credentials, clipboard contents,
            request bodies, headers and email addresses are excluded. Browser
            identities are not joined to CLI identities or other Bramble
            products.
          </p>
          <p>
            With your permission, analytics samples 10% of public-page sessions
            for replay, retained for 30 days. Text and inputs are masked;
            images, media, iframes and private regions are blocked. Recording is
            disabled on authenticated and sign-in screens. Console logs and
            network bodies/headers are not recorded. Both providers process data
            in the United States. Use &quot;Disable website telemetry&quot; in
            the public or workspace footer to stop browser collection and clear
            its analytics identity. Global Privacy Control and Do Not Track also
            disable collection. Opt-out does not erase data already received;
            contact us for privacy requests. Hosted server diagnostics are
            managed separately and contain no memory text.
          </p>
          <p>
            Official production CLI and agent integrations collect anonymous,
            content-free command and connection outcomes, model-request timings,
            and sanitized diagnostics. A private random installation identity
            resets on account changes. Run <code>grove telemetry disable</code>
            or set <code>DO_NOT_TRACK=1</code> or <code>GROVE_TELEMETRY=0</code>
            to disable collection. CI, private mode and development builds do
            not collect. Browser and CLI opt-outs also accompany their API
            requests. Hosted activation events use a server-keyed account
            pseudonym, without linking it to browser or installation identities.
            Background reliability metrics are aggregate, without account
            identifiers.
          </p>
          <p>
            Authentication uses cookies or similar session storage needed to
            keep you signed in. The CLI keeps protected credentials on your
            machine, partitioned by API origin, agent, and account.
            Installation-copy controls write the displayed command to your
            clipboard only when selected. Public demos use example content, not
            customer memories.
          </p>
        </>
      ),
    },
    {
      id: "retention",
      title: "Retention and deletion",
      content: (
        <>
          <p>
            Durable memories and revisions are retained. Archiving is
            reversible. Deletion and expired-record cleanup hide notes and their
            history from the app, connected agents and public links; retained
            source records have no automatic deletion deadline.
          </p>
          <p>
            Account deletion immediately blocks access. Background cleanup hides
            retained account content and removes the sign-in identity. Deletion
            removes derived vectors and pending associated work. Tombstones
            prevent deleted information from reappearing after recovery.
            Generated export files expire after one day; infrastructure logs and
            provider records have separate operational lifecycles.
          </p>
          <p>
            The hosted database currently has a one-day point-in-time recovery
            window. Deletion does not instantly rewrite that history or
            independent exports. Restores must reconcile newer deletion and
            revocation decisions before reopening access. Contact us about a
            deletion request or any information retained for legal or security
            reasons.
          </p>
        </>
      ),
    },
    {
      id: "rights",
      title: "Your choices and rights",
      content: (
        <>
          <p>
            Use the memory library and connection settings to manage saved
            context and access. You can export your data or request account
            deletion in Settings. You can also email us for access, correction,
            deletion, portability, or questions about processing. We may need to
            verify that you control the account and explain any lawful
            exceptions.
          </p>
          <p>
            Depending on your location, you may have rights to restrict or
            object to processing, withdraw consent, or complain to a privacy
            authority. Nothing in this policy limits mandatory rights. If you
            believe a child has provided personal information without required
            authorization, contact us.
          </p>
        </>
      ),
    },
    {
      id: "changes",
      title: "Security and policy updates",
      content: (
        <>
          <p>
            We use authenticated access, scoped permissions, account-level
            database controls, protected credentials, and encrypted network
            transport for the hosted service. No system can promise perfect
            security. Contact us privately about suspected exposure; do not post
            secrets or memory content in a public issue.
          </p>
          <p>
            We update this policy when our practices change, show the effective
            date, and provide notice or obtain additional consent where
            required.
          </p>
        </>
      ),
    },
  ],
};

export const terms: LegalDocument = {
  title: "Terms & conditions.",
  summary:
    "Terms for using the Grove website, hosted memory service and integrations.",
  sections: [
    {
      id: "agreement",
      title: "About these terms",
      content: (
        <>
          <p>
            These terms are between you and Bramble Labs Inc. and apply to
            Grove&apos;s website and hosted services. By using them, you agree
            to these terms. If you use Grove for an organization, you must have
            authority to accept on its behalf. You must be legally able to enter
            this agreement and obtain any parental or guardian permission
            required where you live.
          </p>
          <p>
            Our <a href="/privacy">Privacy policy</a> explains information
            handling. Agreeing to these terms does not replace consent
            separately required by law. Open-source software is also governed by
            the licence distributed with it.
          </p>
        </>
      ),
    },
    {
      id: "service",
      title: "What Grove provides",
      content: (
        <>
          <p>
            Grove stores and retrieves selected context through its memory
            library, API, and agent integrations. Features include saving,
            searching, revising, archiving, exporting, and deleting memories and
            managing connections. Availability can depend on your client,
            configuration, version, and hosting choice.
          </p>
          <p>
            Memory retrieval and AI outputs can be incomplete or incorrect.
            Review important decisions and outputs before relying on them. Grove
            does not guarantee an agent will save a particular fact, retrieve
            every relevant memory, or produce a particular result. Website
            examples are illustrative.
          </p>
        </>
      ),
    },
    {
      id: "account",
      title: "Accounts and connections",
      content: (
        <>
          <p>
            Provide accurate account information, protect credentials, review
            scopes before approving an agent, and revoke access you no longer
            need. You are responsible for activity you authorize, including an
            agent&apos;s saves, edits, or deletions. Tell us about suspected
            unauthorized access at{" "}
            <a href="mailto:grove@mawa.dev">grove@mawa.dev</a>.
          </p>
          <p>
            Do not use another person&apos;s account or bypass account/project
            boundaries. Connecting a third-party agent authorizes the data
            exchange needed for the scopes you approve; that service&apos;s own
            terms also apply.
          </p>
        </>
      ),
    },
    {
      id: "content",
      title: "Your content and permissions",
      content: (
        <>
          <p>
            You retain your rights in the content you submit. You give us a
            non-exclusive, worldwide, royalty-free permission to host,
            reproduce, index, format, transmit, and otherwise process it only as
            needed to operate the features you use, including through our
            providers and approved connections. This does not transfer ownership
            or permit unrelated advertising use.
          </p>
          <p>
            You must have the rights and permissions needed for submitted
            content, including information about other people. Keep independent
            copies of important information. Deletion cannot recall copies
            already delivered to agents or other recipients.
          </p>
        </>
      ),
    },
    {
      id: "use",
      title: "Acceptable use",
      content: (
        <>
          <p>
            Use Grove lawfully. Do not upload unlawful or infringing material;
            steal credentials; access another account&apos;s memories; probe or
            disrupt services without authorization; distribute malware; evade
            limits; send spam; or use the service to harm, defraud, or
            unlawfully monitor others.
          </p>
          <p>
            We may apply reasonable limits, investigate violations, or restrict
            access to protect the service and its users. Report security
            concerns privately, without including unnecessary sensitive content.
          </p>
        </>
      ),
    },
    {
      id: "hosting",
      title: "Open source and self-hosting",
      content: (
        <>
          <p>
            Grove&apos;s open-source components are provided under their
            published licences. Those licences govern copying, modification, and
            distribution of the software; these terms govern access to our
            hosted service and website. They do not withdraw rights granted by
            an open-source licence.
          </p>
          <p>
            If you self-host, you are responsible for configuration,
            credentials, backups, security, providers, and the privacy
            obligations of your deployment. A software licence does not include
            a promise of hosted support, uptime, or access to Bramble Labs
            infrastructure.
          </p>
        </>
      ),
    },
    {
      id: "changes",
      title: "Availability, changes, and charges",
      content: (
        <>
          <p>
            We may improve, change, or discontinue features, with notice where
            required. We do not promise uninterrupted availability or a
            particular retention period beyond the commitments in the Privacy
            policy and any separate agreement. Any paid offering must present
            its price, renewal, cancellation, and applicable terms before you
            purchase; these terms alone do not enroll you in a subscription.
          </p>
        </>
      ),
    },
    {
      id: "ending",
      title: "Ending use",
      content: (
        <>
          <p>
            You can stop using Grove, revoke connections, and request account
            deletion. We may suspend or end access for material violations,
            legal requirements, or security risks, providing notice and an
            opportunity to address the issue where appropriate. Contact us if
            you believe a restriction is mistaken.
          </p>
          <p>
            Content handling after closure follows the Privacy policy.
            Ownership, accrued obligations, and provisions that reasonably need
            to survive continue where lawful.
          </p>
        </>
      ),
    },
    {
      id: "responsibility",
      title: "Responsibility and your legal rights",
      content: (
        <>
          <p>
            To the extent permitted by law, the service is provided as available
            without guarantees of uninterrupted operation, complete retrieval,
            or fitness for a particular purpose. We remain responsible for the
            care and obligations the law requires.
          </p>
          <p>
            To the extent permitted by law, we are not liable for indirect or
            consequential loss, lost profits, or failures of independently
            operated third-party services. This does not exclude liability that
            cannot lawfully be excluded, including fraud, intentional
            misconduct, or mandatory consumer protections. Nothing requires
            arbitration or waives a complaint or court remedy guaranteed by law.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      title: "Updates and contact",
      content: (
        <>
          <p>
            We may revise these terms and will provide notice or request renewed
            acceptance where required. If a provision cannot be enforced, the
            remainder continues to the extent lawful. Contact{" "}
            <a href="mailto:grove@mawa.dev">grove@mawa.dev</a> for service,
            legal, or rights-holder concerns, including enough information for
            us to understand and respond.
          </p>
        </>
      ),
    },
  ],
};
